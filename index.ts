import { Mastra } from '@mastra/core';
import { createNodeMiddleware } from '@mastra/core'; // Nuovo import necessario
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
 * HANDLER AGGIORNATO PER VERCEL
 * Ora instrada correttamente le chiamate ai workflow
 */
const handler = async (req: any, res: any) => {
  // Se la richiesta va verso i workflow, lasciamo che Mastra la gestisca
  if (req.url?.includes('/api/workflows') || req.url?.includes('/api/agents')) {
    const middleware = createNodeMiddleware(mastra);
    return await middleware(req, res);
  }

  // Altrimenti, mostra lo stato (come prima)
  return res.status(200).json({ 
    status: 'Radiociclismo AI Engine Online',
    message: 'Mastra Agent is ready',
    version: '2.0.1',
    timestamp: new Date().toISOString()
  });
};

export default handler;
