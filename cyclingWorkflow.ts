import { createWorkflow } from '@mastra/core';
import { z } from 'zod';
import { saveRaceResults, savePendingArticles } from './db';
// Importa il tuo agente (assicurati che il percorso sia corretto)
import { cyclingAgent } from './agents'; 

export const cyclingWorkflow = createWorkflow({
  name: 'cycling-sync',
  inputs: {
    raceUrl: z.string().describe('URL di ProCyclingStats della gara'),
    raceName: z.string().describe('Nome della gara'),
  },
  outputs: {
    success: z.boolean(),
  },
  // In Mastra v2+, gli step si definiscono nell'oggetto 'steps'
  steps: {
    // STEP 1: Estrazione dati con l'Agente
    fetchRaceData: {
      handler: async ({ context }) => {
        const { raceUrl, raceName } = context.inputs;

        // L'agente usa i suoi tool per grattare i dati
        const result = await cyclingAgent.generate(
          `Estrai la classifica Top 10 per la gara ${raceName} dall'URL: ${raceUrl}. 
           Ritorna i dati in formato JSON con: posizione, nome, squadra, distacco.`
        );

        // Supponiamo che l'agente restituisca un JSON strutturato
        const extractedData = JSON.parse(result.text);

        return {
          externalId: raceUrl.split('/').pop() || 'race-id',
          name: raceName,
          results: extractedData.top10, // Array di {position, name, team, gap}
          articleIt: result.text, // L'articolo generato in italiano
        };
      },
    },

    // STEP 2: Salvataggio nel Database (Gestione Gare)
    saveToDb: {
      handler: async ({ context }) => {
        const data = context.getStepResult('fetchRaceData');

        if (!data) throw new Error('Nessun dato ricevuto dallo step precedente');

        // 1. Salviamo i dati atomici per le tabelle delle gare (per radiociclismo.com)
        await saveRaceResults({
          externalId: data.externalId,
          name: data.name,
          results: data.results,
        });

        // 2. Salviamo l'articolo testuale per il blog
        await savePendingArticles([
          {
            slug: data.externalId,
            titleIt: data.name,
            contentIt: data.articleIt,
            titleEn: data.name + " Results", // Esempio semplice
            contentEn: "Translation pending...",
          },
        ]);

        return { success: true };
      },
    },
  },
});

// Nota: Il commit() non è più necessario come funzione concatenata in alcune versioni, 
// l'oggetto restituito da createWorkflow è già pronto.
