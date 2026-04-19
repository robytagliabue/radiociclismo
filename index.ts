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

export default async function handler(req: any, res: any) {
  // Se l'URL contiene /api/, delega a Mastra (questo abilita i workflow)
  if (req.url?.includes('/api/')) {
    const mastraMiddleware = createNodeMiddleware(mastra);
    return await mastraMiddleware(req, res);
  }

  // Risposta di stato (Versione aggiornata a 2.0.1)
  res.status(200).json({ 
    status: 'Radiociclismo AI Engine Online',
    message: 'Mastra Agent is ready',
    version: '2.0.1', 
    timestamp: new Date().toISOString()
  });
}
