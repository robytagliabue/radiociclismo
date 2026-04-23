import { Workflow } from 'mastra'; // Cambiato da @mastra/core a mastra
import { z } from 'zod';
import { cyclingAgent } from './cyclingAgent.js';
import { saveRaceResults, savePendingArticles } from './db.js';

export const cyclingWorkflow = new Workflow({
  name: 'cycling-sync',
  triggerSchema: z.object({ // 'inputs' ora si chiama 'triggerSchema'
    raceUrl: z.string(),
    raceName: z.string(),
  }),
})
  .step('fetchAndGenerate', {
    execute: async ({ context }) => {
      // Qui va la tua logica di esecuzione dell'agente
      // Esempio:
      // const result = await cyclingAgent.generate(...)
      return { success: true };
    },
  })
  .commit(); // Importante aggiungere .commit() alla fine
