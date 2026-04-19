import { Mastra, createNodeMiddleware } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

export const mastra = new Mastra({
  agents: { cyclingAgent },
  workflows: { cyclingWorkflow },
});

export default async function handler(req: any, res: any) {
  const url = req.url || '';

  // Forza il middleware per qualsiasi chiamata che contenga 'api'
  if (url.includes('/api/')) {
    const middleware = createNodeMiddleware(mastra);
    return await middleware(req, res);
  }

  // Risposta di controllo - SE LEGGI 2.0.0 IL PUSH NON È ANDATO A BUON FINE
  return res.status(200).json({ 
    status: 'Radiociclismo AI Engine Online',
    version: '2.0.1',
    note: 'Middleware Active',
    timestamp: new Date().toISOString()
  });
}
