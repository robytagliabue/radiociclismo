import { createWorkflow } from '@mastra/core';
import { z } from 'zod';
// Aggiunto .js agli import relativi per risolvere l'errore ERR_MODULE_NOT_FOUND
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

        // L'agente esegue la ricerca e formatta i dati (Articolo + Top 10)
        const result = await cyclingAgent.generate(
          `Analizza la gara ciclistica "${raceName}" usando l'URL: ${raceUrl}. 
           1. Scrivi un articolo giornalistico professionale in italiano.
           2. Estrai la classifica Top 10 ufficiale.
           Ritorna i dati della classifica in un formato JSON strutturato con: 
           posizione, nome del corridore, squadra e distacco.`
        );

        // Prepariamo i dati per il database di Radiociclismo
        const raceData = {
          externalId: raceUrl.split('/').pop() || `race-${Date.now()}`,
          name: raceName,
          results: result.object?.top10 || [], 
          contentIt: result.text,
        };

        // --- AZIONE 1: Caricamento in Gestione Gare (Tabelle races e race_results) ---
        await saveRaceResults({
          externalId: raceData.externalId,
          name: raceData.name,
          results: raceData.results,
        });

        // --- AZIONE 2: Caricamento Articolo (Tabella published_articles) ---
        await savePendingArticles([
          {
            slug: raceData.externalId,
            titleIt: raceData.name,
            contentIt: raceData.contentIt,
            titleEn: `${raceData.name} - Results`,
            contentEn: "Translation in progress...",
          }
        ]);

        return { success: true };
      },
    },
  },
});
