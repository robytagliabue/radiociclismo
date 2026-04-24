import { createTool } from 'mastra';
import { z } from 'zod';

export const webSearchRacesTool = createTool({
  id: 'web-search-races',
  description: 'Search for cycling race results and rankings',
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ input }) => {
    // Logica temporanea per non far crashare il sistema
    console.log('Searching for:', input.query);
    
    return { 
      results: [],
      message: "Search tool is active but in standby mode." 
    };
  },
});
