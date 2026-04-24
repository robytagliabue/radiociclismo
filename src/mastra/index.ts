import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serve as serveInngest } from 'inngest/hono';

// 1. Inizializzazione Mastra
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

/**
 * 2. Rotta Inngest Universale
 * In molte versioni di Mastra, mastra.inngest contiene già tutto il necessario
 */
app.use('/api/inngest', async (c, next) => {
  // Recuperiamo le funzioni in modo dinamico
  const inngestFunctions = (mastra as any).getWorkflowInngestFunctions?.() || [];
  const inngestClient = (mastra as any).inngest || (mastra as any).inngestClient;

  const handler = serveInngest({
    client: inngestClient,
    functions: inngestFunctions,
  });
  
  return handler(c, next);
});

// Rotta di cortesia
app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

// 3. Avvio Server
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server in ascolto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
