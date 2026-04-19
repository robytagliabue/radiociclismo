import { z } from "zod";

// --- IMPORT LOCALI CORRETTI ---
// Nota: usiamo "./inngest.js" perché abbiamo rinominato il file per index.ts
import { createStep, createWorkflow } from "./inngest.js"; 
import { cyclingAgent } from "./cyclingAgent.js";
import { webSearchRacesTool } from "./webSearchRacesTool.js";
import { 
  acquireWorkflowLock, 
  releaseWorkflowLock,
  savePendingArticles 
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
  rankings: z.array(rankingEntrySchema).optional().default([]),
});

// --- STEP 1: RICERCA GARE ---
const searchRacesStep = createStep({
  id: "search-races",
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    
    // 1. Acquisizione Lock
    const locked = await acquireWorkflowLock();
    if (!locked) {
      logger?.warn("🔒 Workflow già in esecuzione o lock attivo.");
      return { found: false, searchResults: "" };
    }

    try {
      // 2. Esecuzione Tool di ricerca
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
      };
    } catch (error) {
      logger?.error("❌ Errore durante la ricerca gare", { error });
      return { found: false, searchResults: "" };
    }
  },
});

// --- STEP 2: GENERAZIONE ARTICOLI ---
const generateArticlesStep = createStep({
  id: "generate-articles",
  inputSchema: z.object({
    found: z.boolean(),
    searchResults: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    
    if (!inputData.found || !inputData.searchResults) {
      await releaseWorkflowLock();
      return { articles: [] };
    }

    try {
      const prompt = `Analizza questi dati di ciclismo e scrivi un articolo professionale: ${inputData.searchResults}`;
      
      const response = await cyclingAgent.generate(prompt);
      
      if (response.object) {
        // Salviamo nel DB come "pending" invece di pubblicare subito
        await savePendingArticles([response.object]);
        logger?.info("✅ Articolo generato e salvato in attesa di revisione.");
        return { articles: [response.object] };
      }
      
      return { articles: [] };
    } catch (error) {
      logger?.error("❌ Errore generazione articolo", { error });
      return { articles: [] };
    } finally {
      // Rilasciamo sempre il lock alla fine
      await releaseWorkflowLock();
    }
  },
});

// --- DEFINIZIONE WORKFLOW ---
export const cyclingWorkflow = createWorkflow({
  name: "cyclingWorkflow",
  triggerSchema: z.object({}),
})
  .step(searchRacesStep)
  .then(generateArticlesStep)
  .commit();
