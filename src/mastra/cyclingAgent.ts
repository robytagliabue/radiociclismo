import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic';
import { listArticlesTool, deleteArticleTool } from './radiociclismoTool.js';

export const cyclingAgent = new (Agent as any)({
  name: 'Cycling Analyst',
  instructions: `Sei l'esperto senior di RadioCiclismo. 
  Scrivi articoli tecnici, accurati e appassionanti. 
  Usa i tool a disposizione per verificare se un contenuto esiste già.`,
  model: anthropic('claude-sonnet-4-20250514'),
  tools: { listArticlesTool, deleteArticleTool },
});
