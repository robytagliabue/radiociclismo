import { Workflow } from '@mastra/core';
// Se continua a dare errore TS2305, prova così:
// import { mastra as Mastra, agent as Agent, workflow as Workflow } from 'mastra';
import { z } from 'zod';
import { cyclingAgent } from './cyclingAgent.js';

export const cyclingWorkflow = new (Workflow as any)({
  name: 'cycling-sync',
  triggerSchema: z.object({
    raceUrl: z.string().url(),
    raceName: z.string().optional(),
  }),
})
  .step('fetchData', {
    execute: async ({ context }) => {
      const { raceUrl, raceName } = context.triggerData;
      console.log(`Inizio analisi per: ${raceName || 'Gara'} - URL: ${raceUrl}`);
      
      // In questa fase passiamo i dati all'agente
      return {
        url: raceUrl,
        name: raceName || 'Gara Ciclismo',
      };
    },
  })
  .step('generateAnalysis', {
    execute: async ({ context }) => {
      const data = context.getStepResult('fetchData');
      
      if (!data) {
        throw new Error('Dati non ricevuti dallo step precedente');
      }

      // L'agente entra in azione qui
      const result = await cyclingAgent.generate(
        `Analizza i risultati della gara all'indirizzo ${data.url} e fornisci la top 10 ufficiale.`
      );

      return {
        analysis: result.text,
        structuredData: result.object, // Se abbiamo definito uno schema nell'agente
      };
    },
  })
  .commit();
