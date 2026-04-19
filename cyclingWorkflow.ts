import { createWorkflow } from '@mastra/core';
import { z } from 'zod';
// Aggiunto .js all'import per compatibilità Vercel ESM
import { saveRaceResults, savePendingArticles } from './db.js';
import { cyclingAgent } from './agents.js'; 

export const cyclingWorkflow = createWorkflow({
  name: 'cycling-sync',
  inputs: {
    raceUrl: z.string().describe('URL ProCyclingStats della gara'),
    raceName: z.string().describe('Nome della gara'),
  },
  outputs: {
    success: z.boolean(),
  },
  steps: {
    fetchAndProcess: {
      handler: async ({ context }) => {
        const { raceUrl, raceName } = context.inputs;

        // L'agente esegue la ricerca e formatta i dati
        const result = await cyclingAgent.generate(
          `Analizza la gara "${raceName}" dall'URL: ${raceUrl}. 
           Estrai la Top 10 e scrivi un articolo. 
           Ritorna i dati della classifica in formato JSON strutturato.`
        );

        // Prepariamo i dati per il database di Radiociclismo
        const raceData = {
          externalId: raceUrl.split('/').pop() || `race-${Date.now()}`,
          name: raceName,
          results: result.object?.top10 || [], 
          contentIt: result.text,
        };

        // 1. Caricamento in Gestione Gare (Tabelle tecniche)
        await saveRaceResults({
          externalId: raceData.externalId,
          name: raceData.name,
          results: raceData.results,
        });

        // 2. Caricamento Articolo (Tabella news)
        await savePendingArticles([
          {
            slug: raceData.externalId,
            titleIt: raceData.name,
            contentIt: raceData.contentIt,
            titleEn: `${raceData.name} Results`,
            contentEn: "Translation pending...",
          }
        ]);

        return { success: true };
      },
    },
  },
});
