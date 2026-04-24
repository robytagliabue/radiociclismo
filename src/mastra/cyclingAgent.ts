import { Agent } from '@mastra/core';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { listArticlesTool, deleteArticleTool } from './radiociclismoTool.js';

export const cyclingAgent = new Agent({
  name: 'Cycling Analyst',
  instructions: 'Sei un esperto di ciclismo professionistico. Analizza i dati della corsa e fornisci la top 10 ufficiale in formato strutturato.',
  model: google('gemini-1.5-flash'),
  enabledTools: {
    listArticlesTool,
    deleteArticleTool,
  },
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
