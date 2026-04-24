import { Agent } from 'mastra'; // Torna a 'mastra' invece di '@mastra/core'
import { google } from '@ai-sdk/google';
import { z } from 'zod';

export const cyclingAgent = new Agent({
  name: 'Cycling Analyst',
  instructions: 'Sei un esperto di ciclismo. Analizza i dati e genera classifiche accurate.',
  model: google('gemini-1.5-flash'),
  /* I tools sono commentati per evitare errori di import finché 
    non sistemiamo radiociclismoTool.ts 
  */
  /*
  enabledTools: {
    // listArticlesTool,
    // deleteArticleTool,
    // webSearchRacesTool,
  },
  */
  outputs: {
    schema: z.object({
      top10: z.array(
        z.object({
          posizione: z.number(),
          nome: z.string(),
          squadra: z.string(),
          distacco: z.string(),
        })
      ),
    }),
  },
});
