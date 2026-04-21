import { createWorkflow } from '@mastra/core';
import { z } from 'zod';
import { cyclingAgent } from './cyclingAgent.js';

export const cyclingWorkflow = createWorkflow({
  name: 'cycling-sync',
  inputs: {
    raceUrl: z.string().describe('URL ProCyclingStats della gara'),
    raceName: z.string().describe('Nome della gara'),
  },
  steps: {
    fetchAndProcess: {
      handler: async ({ context }) => {
        const { raceUrl, raceName } = context.inputs;

        // L'agente analizza l'URL per capire se è maschile o femminile
        const result = await cyclingAgent.generate(
          `Analizza la gara ciclistica "${raceName}" visitando l'URL: ${raceUrl}.
           
           COMPITI CRITICI:
           1. Identifica se la gara è CATEGORIA MASCHILE o FEMMINILE (cerca "Women" o "-we-" nell'URL).
           2. Estrai la classifica Top 10 reale senza inventare dati.
           3. Verifica tramite i tuoi tool se esiste già un articolo nel database per questa gara.
           4. Scrivi un articolo in italiano con un titolo che specifichi chiaramente la categoria (es. [DONNE] o [UOMINI]).
           5. Salva i risultati e l'articolo su Supabase.`
        );

        return {
          success: true,
          data: result.text,
        };
      },
    },
  },
});
import { createWorkflow } from '@mastra/core';
import { z } from 'zod';
// Import con estensione .js necessaria per l'ambiente Vercel (ESM)
// Puntiamo al file cyclingagent.js (che corrisponde al tuo cyclingagent.ts)
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
  // In Mastra v2+, gli step si definiscono come proprietà dell'oggetto 'steps'
  steps: {
    fetchAndProcess: {
      handler: async ({ context }) => {
        const { raceUrl, raceName } = context.inputs;

        // L'agente esegue la ricerca e genera i contenuti
        // Utilizziamo .generate() come indicato nella documentazione V2
        const result = await cyclingAgent.generate(
          `Analizza la gara ciclistica "${raceName}" usando l'URL: ${raceUrl}. 
           1. Scrivi un articolo giornalistico professionale in italiano.
           2. Estrai la classifica Top 10 ufficiale.
           Ritorna i dati della classifica in un formato JSON strutturato con i campi: 
           posizione, nome del corridore, squadra e distacco.`
        );

        // Prepariamo i dati per il database di Radiociclismo.com
        const raceData = {
          externalId: raceUrl.split('/').pop() || `race-${Date.now()}`,
          name: raceName,
          results: result.object?.top10 || [], // Array strutturato per la tabella race_results
          contentIt: result.text,             // Testo dell'articolo per la tabella published_articles
        };

        // --- AZIONE 1: Popolamento Gestione Gare (Tabelle tecniche races e race_results) ---
        await saveRaceResults({
          externalId: raceData.externalId,
          name: raceData.name,
          results: raceData.results,
        });

        // --- AZIONE 2: Salvataggio Articolo (Tabella published_articles) ---
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
