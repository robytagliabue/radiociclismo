import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

// 1. Inizializzazione Mastra
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// 2. Configurazione Inngest
const inngest = new Inngest({ id: 'radiociclismo-ai' });

/**
 * CREAZIONE FUNZIONE INNGEST - SINTASSI CORRETTA v4
 */
const cyclingInngestFn = inngest.createFunction(
  { 
    id: 'cycling-workflow', 
    name: 'Cycling Workflow',
    triggers: [{ event: 'mastra/workflow.cyclingWorkflow.run' }] 
  },
  async ({ event, step }) => {
    const workflow = mastra.getWorkflow('cyclingWorkflow');
    return await workflow.execute({ input: event.data });
  }
);

const app = new Hono();

// 3. Rotta Inngest
app.all('/api/inngest', async (c) => {
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingInngestFn],
    signingKey: process.env.INNGEST_SIGNING_KEY,
  });
  return handler(c);
});

app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server in ascolto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
