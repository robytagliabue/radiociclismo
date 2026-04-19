import { z } from "zod";

// --- IMPORT LOCALI ---
import { createStep, createWorkflow } from "./inngest.js"; 
import { cyclingAgent } from "./cyclingAgent.js";
import { webSearchRacesTool } from "./webSearchRacesTool.js";
import { 
  acquireWorkflowLock, 
  releaseWorkflowLock,
  savePendingArticles 
} from "./db.js";

// Dichiarazione UNICA dello schema
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
    const locked = await acquireWorkflowLock();
    
    if (!locked) {
      logger?.warn("🔒 Lock attivo, salto esecuzione.");
      return { found: false, searchResults: "" };
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
      };
    } catch (error) {
      return { found: false, searchResults: "" };
    }
  },
});

// --- STEP 2: GENERAZIONE ---
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
      const response = await cyclingAgent.generate(
        `Genera un articolo JSON da questi dati: ${inputData.searchResults}`
      );
      
      if (response.object) {
        await savePendingArticles([response.object]);
        return { articles: [response.object] };
      }
      return { articles: [] };
    } catch (error) {
      return { articles: [] };
    } finally {
      await releaseWorkflowLock();
    }
  },
});

export const cyclingWorkflow = createWorkflow({
  name: "cyclingWorkflow",
  triggerSchema: z.object({}),
})
  .step(searchRacesStep)
  .then(generateArticlesStep)
  .commit();
