import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

// 1. Mastra
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// 2. Inngest Client Manuale (Così non dipendiamo da Mastra)
const inngest = new Inngest({ 
    id: 'radiociclismo-ai'
});

// Creiamo la funzione avvolgendo il workflow
const cyclingFn = inngest.createFunction(
  { id: 'cycling-workflow', name: 'Cycling Workflow' },
  { event: 'mastra/workflow.cyclingWorkflow.run' },
  async ({ event }) => {
    const workflow = mastra.getWorkflow('cyclingWorkflow');
    return await workflow.execute({ input: event.data });
  }
);

const app = new Hono();

// 3. Rotta Inngest - La versione più compatibile con Railway
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: process.env.INNGEST_SIGNING_KEY,
  });
  
  // Usiamo il metodo corretto per Hono v4+
  return handler(c);
});

app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server in fuga sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
