import { createTool } from 'mastra';
import { z } from 'zod';

export const webSearchRacesTool = createTool({
  id: 'web-search-races',
  description: 'Cerca risultati di gare ciclistiche, classifiche e startlist aggiornate su ProCyclingStats o siti simili.',
  inputSchema: z.object({
    query: z.string().describe('La gara da cercare (es: "Amstel Gold Race 2026 results")'),
  }),
  outputSchema: z.object({
    results: z.string(),
  }),
  execute: async ({ input }) => {
    // Qui l'agente Gemini userà questo tool per decidere cosa cercare.
    // Il logica di scraping effettiva verrà eseguita dal tuo servizio o via fetch
    console.log('Ricerca in corso per:', input.query);
    
    // Esempio di ritorno dati (qui andrà la tua logica fetch se ce l'hai)
    return {
      results: `Risultati per ${input.query} trovati. Procedi con l'analisi della Top 10.`,
    };
  },
});
