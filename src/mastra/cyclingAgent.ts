import { Agent } from '@mastra/core/agent';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { listArticlesTool, deleteArticleTool } from './radiociclismoTool.js';

export const cyclingAgent = new (Agent as any)({
  name: 'Cycling Analyst',
  instructions: `Sei un esperto di ciclismo mondiale e giovanile. 
  Il tuo compito è scrivere articoli tecnici, accurati e appassionanti. 
  Usa i tool a disposizione per verificare se un contenuto esiste già.
  Rispondi sempre seguendo lo schema JSON richiesto.`,
  
  // AGGIORNAMENTO: Passiamo alla versione 2.0 Flash che avevi testato
  model: google('gemini-2.0-flash-001'), 
  
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
