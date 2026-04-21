import { createTool } from 'mastra';
import { z } from 'zod';

export const webSearchRacesTool = createTool({
  id: 'web-search-races',
  description: 'Cerca risultati di gare ciclistiche e classifiche aggiornate.',
  inputSchema: z.object({
    query: z.string().describe('La gara da cercare (es: "Amstel Gold Race 2026 results")'),
  }),
  outputSchema: z.object({
    results: z.string(),
  }),
  execute: async ({ input }) => {
    console.log('Ricerca in corso per:', input.query);
    return {
      results: `Dati per ${input.query} pronti per l'analisi.`,
    };
  },
});
