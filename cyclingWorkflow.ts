import { createWorkflow } from '@mastra/core';
import { z } from 'zod';
import { saveRaceResults, savePendingArticles } from './db';
import { cyclingAgent } from './agents'; // Assicurati che il percorso sia corretto nel tuo progetto

export const cyclingWorkflow = createWorkflow({
  name: 'cycling-sync',
  inputs: {
    raceUrl: z.string().describe('URL ProCyclingStats della gara'),
    raceName: z.string().describe('Nome della gara'),
  },
  outputs: {
    success: z.boolean(),
  },
  // In Mastra v2+, gli step si definiscono come un oggetto 'steps'
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

        // Prepariamo i dati per il database
        // Nota: Assicurati che il tuo agente sia configurato per restituire 'object' tramite Mastra
        // o estrai i dati dal testo se necessario.
        const raceData = {
          externalId: raceUrl.split('/').pop() || `race-${Date.now()}`,
          name: raceName,
          results: result.object?.top10 || [], // Array di {position, name, team, gap}
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
