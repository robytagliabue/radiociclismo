// src/cyclingAgent.ts
import { Agent } from '@mastra/core/agent';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { listArticlesTool, deleteArticleTool } from './radiociclismoTool.js';

export const cyclingAgent = new (Agent as any)({
  name: 'Cycling Analyst',
  instructions: 'Sei un esperto di ciclismo... [le tue istruzioni]',
  model: google('gemini-1.5-flash'),
  tools: { listArticlesTool, deleteArticleTool },
  outputs: {
    schema: z.object({
      titolo: z.string(),
      contenuto: z.string(),
      excerpt: z.string(),
      slug: z.string(),
      tags: z.array(z.string()),
      // mantieni qui lo schema che preferisci per il tuo DB
    }),
  },
});
