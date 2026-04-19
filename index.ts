import { Mastra, createNodeMiddleware } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

export const mastra = new Mastra({
  agents: {
    cyclingAgent,
  },
  workflows: {
    cyclingWorkflow,
  },
});

/**
 * HANDLER PER VERCEL
 * Questo blocco è il "vigile urbano":
 * Se la chiamata è per un workflow o un agente, la passa a Mastra.
 * Altrimenti, risponde con il messaggio di stato.
 */
export default async function handler(req: any, res: any) {
  // Se l'URL contiene /api/workflows o /api/agents, delega a Mastra
  if (req.url?.includes('/api/')) {
    const mastraMiddleware = createNodeMiddleware(mastra);
    return await mastraMiddleware(req, res);
  }

  // Risposta di default se visiti la home del progetto
  res.status(200).json({ 
    status: 'Radiociclismo AI Engine Online',
    message: 'Mastra Agent is ready',
    version: '2.0.1',
    timestamp: new Date().toISOString()
  });
}
