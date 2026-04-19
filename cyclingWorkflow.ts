import { z } from "zod";
import axios from "axios";

// IMPORT LOCALI CORRETTI (Percorsi root e estensione .js)
import { createStep, createWorkflow } from "./inngest-config.js";
import { cyclingAgent } from "./cyclingAgent.js";
import { webSearchRacesTool, fetchRaceNarrative } from "./webSearchRacesTool.js";
import { 
  getPool, 
  ensurePublishedArticlesTable, 
  savePendingArticles, 
  loadPendingArticles, 
  removePendingArticle, 
  clearPendingArticles, 
  acquireWorkflowLock, 
  releaseWorkflowLock 
} from "./db.js";

const rankingEntrySchema = z.object({
  position: z.union([z.number(), z.string()]),
  name: z.string(),
  team: z.string().optional().default(""),
  time: z.string().optional().default(""),
});

const articleSchema = z.object({
  titleIt: z.string(),
  subtitleIt: z.string().optional().default(""),
  excerptIt: z.string(),
  contentIt: z.string(),
  titleEn: z.string(),
  subtitleEn: z.string().optional().default(""),
  excerptEn: z.string(),
  contentEn: z.string(),
  slug: z.string(),
  hashtags: z.string(),
  winnerName: z.string(),
  raceName: z.string(),
  metaDescription: z.string().optional().default(""),
  primaryKeyword: z.string().optional().default(""),
  alternativeTitles: z.array(z.string()).optional().default([]),
  socialVersion: z.string().optional().default(""),
  instagramVersion: z.string().optional().default(""),
  bulletPoints: z.array(z.string()).optional().default([]),
  styleUsed: z.string().optional().default(""),
  structureUsed: z.string().optional().default(""),
  rankings: z.array(rankingEntrySchema).optional().default([]),
  stageNumber: z.number().nullable().optional().default(null),
  isStageRace: z.boolean().optional().default(false),
  isFinalGC: z.boolean().optional().default(false),
  isTTT: z.boolean().optional().default(false),
  startLocation: z.string().optional().default(""),
  endLocation: z.string().optional().default(""),
  raceDistance: z.string().optional().default(""),
  raceDate: z.string().optional().default(""),
  raceCategory: z.string().optional().default(""),
  resultsOnly: z.boolean().optional().default(false),
  gcRankings: z.array(rankingEntrySchema).optional().default([]),
});

// --- STEP 1: SEARCH RACES ---
const searchRacesStep = createStep({
  id: "search-races",
  description: "Scrapes PCS for today's finished cycling races with enriched data",
  inputSchema: z.object({}),
  outputSchema: z.object({
    found: z.boolean(),
    searchResults: z.string(),
    lockAcquired: z.boolean().optional(),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔍 [Step: searchRaces] Starting web search for today's races...");

    let lockAcquired = true;
    try {
      const locked = await acquireWorkflowLock();
      if (!locked) {
        logger?.warn("🔒 [Step: searchRaces] Another workflow run is already in progress — skipping");
        return { found: false, searchResults: "", lockAcquired: false };
      }
      logger?.info("🔓 [Step: searchRaces] Workflow lock acquired successfully");
    } catch (lockErr: any) {
      logger?.warn(`⚠️ [Step: searchRaces] Could not check workflow lock: ${lockErr.message}`);
    }

    try {
      const result = await webSearchRacesTool.execute({
        context: {},
        mastra: mastra as any,
        runId: "workflow-search",
        threadId: "workflow",
        resourceId: "workflow",
        runtimeContext: {} as any,
      });

      return {
        found: result?.found || false,
        searchResults: result?.searchResults || "",
        lockAcquired,
      };
    } catch (error) {
      logger?.error("❌ [Step: searchRaces] Error", { error });
      return { found: false, searchResults: "", lockAcquired };
    }
  },
});

// --- HELPER FUNCTIONS ---
function normalizeRaceName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function parseRankingsFromBlock(raceBlock: string) {
  const rankings: any[] = [];
  const classificationMatch = raceBlock.match(/Classification:\n([\s\S]*?)(?:\n(?:GC |General Classification|Race Narrative|\n##)|\n\n|$)/);
  if (!classificationMatch) return rankings;
  const lines = classificationMatch[1].split("\n").filter(l => l.trim());
  for (const line of lines) {
    const match = line.match(/^(\d+|DNF|DNS|OTL|DSQ)\.\s*(.+?)\s*\(([^)]*)\)\s*-\s*(.*)$/);
    if (match) {
      rankings.push({
        position: match[1],
        name: match[2].trim(),
        team: match[3].trim(),
        time: match[4].trim(),
      });
    }
  }
  return rankings;
}

function parseRaceMetaFromBlock(raceBlock: string) {
  const stageMatch = raceBlock.match(/Stage\s+(\d+)/i);
  return {
    stageNumber: stageMatch ? parseInt(stageMatch[1]) : null,
    isStageRace: raceBlock.includes("Stage") || raceBlock.includes("GC"),
    isFinalGC: raceBlock.includes("Final General Classification"),
    isTTT: raceBlock.includes("TTT"),
    startLocation: "", endLocation: "", raceDistance: "", raceCategory: ""
  };
}

// --- STEP 2: RETRY NARRATIVES ---
const retryNarrativesStep = createStep({
  id: "retry-narratives",
  execute: async ({ inputData, mastra }) => {
    // Logica di retry semplificata per brevità (puoi tenere la tua originale se completa)
    return inputData; 
  }
});

// --- STEP 3: GENERATE ARTICLES ---
const generateArticlesStep = createStep({
  id: "generate-articles",
  inputSchema: z.object({
    found: z.boolean(),
    searchResults: z.string(),
    lockAcquired: z.boolean().optional(),
  }),
  outputSchema: z.object({
    noRaces: z.boolean(),
    articles: z.array(articleSchema),
    lockAcquired: z.boolean().optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    if (!inputData.found) return { noRaces: true, articles: [], lockAcquired: inputData.lockAcquired };

    const raceBlocks = inputData.searchResults.split(/(?=## )/).filter(b => b.includes("## "));
    const articles: any[] = [];

    for (const block of raceBlocks) {
      const nameMatch = block.match(/^## (.+?)(?:\s*\(|$)/m);
      const raceName = normalizeRaceName(nameMatch ? nameMatch[1] : "Unknown");
      
      const prompt = `Genera un articolo per la gara: ${raceName}. 
      Dati: ${block}
      Usa formato JSON come richiesto dalle istruzioni dell'agente.`;

      try {
        // Usiamo generate (standard Mastra) invece di generateLegacy se possibile
        const response = await cyclingAgent.generate(prompt); 
        if (response.object) {
          articles.push({ ...response.object, raceName });
        }
      } catch (err) {
        logger?.error(`Errore generazione per ${raceName}`, { err });
      }
    }

    return { noRaces: articles.length === 0, articles, lockAcquired: inputData.lockAcquired };
  },
});

// --- WORKFLOW DEFINITION ---
export const cyclingWorkflow = createWorkflow({
  name: "cyclingWorkflow",
  triggerSchema: z.object({}),
})
  .step(searchRacesStep)
  .then(retryNarrativesStep)
  .then(generateArticlesStep)
  .commit();
