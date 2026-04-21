import { createWorkflow } from '@mastra/core';
import { z } from 'zod';
// Import con estensione .js necessaria per l'ambiente Vercel (ESM)
import { saveRaceResults, savePendingArticles } from './db.js';
import { cyclingAgent } from './cyclingAgent.js'; 

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

        // L'agente esegue la ricerca e genera i contenuti
        const result = await cyclingAgent.generate(
          `Analizza la gara ciclistica "${raceName}" usando l'URL: ${raceUrl}. 
           1. Identifica se è una gara Uomini o Donne.
           2. Scrivi un articolo giornalistico professionale in italiano.
           3. Estrai la classifica Top 10 ufficiale.
           Ritorna i dati della classifica in un formato JSON strutturato con i campi: 
           posizione, nome del corridore, squadra e distacco.`
        );

        // Prepariamo i dati per il database
        const raceData = {
          externalId: raceUrl.split('/').filter(Boolean).pop() || `race-${Date.now()}`,
          name: raceName,
          results: result.object?.top10 || [], 
          contentIt: result.text,
        };

        // Salva i risultati tecnici (classifiche)
        await saveRaceResults({
          externalId: raceData.externalId,
          name: raceData.name,
          results: raceData.results,
        });

        // Salva l'articolo per Radiociclismo.com
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
