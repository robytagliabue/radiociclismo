import { createTool } from 'mastra'; // Assicurati che sia importato così

export const webSearchRacesTool = createTool({
  id: 'web-search-races',
  description: 'Search for cycling race results',
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ input }) => {
    // la tua logica qui
    return { results: [] };
  },
});
