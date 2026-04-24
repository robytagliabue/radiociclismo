import { Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { cyclingAgent } from './cyclingAgent.js';

export const cyclingWorkflow = new Workflow({
  name: 'cycling-workflow',
  triggerSchema: z.object({
    input: z.string(), // o quello che ti serve come input
  }),
  steps: [
    {
      id: 'fetchData',
      execute: async ({ context }) => {
        // La tua logica qui
        // Esempio di chiamata all'agente:
        const result = await cyclingAgent.generate(context.triggerData.input);
        
        return {
          analysis: result.text,
          // structuredData: result.object, // Se usi schemi nell'agente
        };
      },
    },
  ],
});
