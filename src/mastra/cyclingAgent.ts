import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic'; // <--- Nuovo provider
import { z } from 'zod';
import { listArticlesTool, deleteArticleTool } from './radiociclismoTool.js';

export const cyclingAgent = new (Agent as any)({
  name: 'Cycling Analyst',
  instructions: `Sei l'esperto senior di RadioCiclismo. 
  Scrivi articoli tecnici, accurati e coinvolgenti sul ciclismo mondiale e giovanile.
  Verifica sempre i duplicati tramite i tool.
  Rispondi SEMPRE con lo schema JSON indicato.`,
  
  // Usiamo Claude 3.5 Sonnet (potente) o Claude 3 Haiku (veloce/economico)
  model: anthropic('claude-3-5-sonnet-20240620'), 
  
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
