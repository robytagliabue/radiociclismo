import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { listArticlesTool, deleteArticleTool } from './radiociclismoTool.js';

export const cyclingAgent = new (Agent as any)({
  name: 'Cycling Analyst',
  instructions: `Sei l'esperto senior di RadioCiclismo. 
  Scrivi articoli tecnici, accurati e appassionanti. 
  Usa i tool a disposizione per verificare se un contenuto esiste già.
  Rispondi sempre seguendo lo schema JSON richiesto.`,
  
  // ✅ Usiamo il modello attuale stabile 2026
  model: anthropic('claude-sonnet-4-20250514'), 
  
  tools: { listArticlesTool, deleteArticleTool },
  
  outputs: {
    schema: z.object({
      titolo: z.string(),
      contenuto: z.string(),
      excerpt: z.string(),
      slug: z.string(),
      tags: z.array(z.string()),
    }),
  },
});
