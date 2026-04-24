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

// 2. Inngest
const inngest = new Inngest({ id: 'radiociclismo-ai' });

/**
 * CREAZIONE FUNZIONE - SINTASSI RIGIDA v4
 * Il primo oggetto DEVE avere id e triggers.
 * Il secondo argomento DEVE essere la funzione.
 */
const cyclingFn = inngest.createFunction(
  { 
    id: 'cycling-workflow',
    triggers: [{ event: 'mastra/workflow.cyclingWorkflow.run' }] 
  },
  async ({ event }) => {
    const workflow = mastra.getWorkflow('cyclingWorkflow');
    return await workflow.execute({ input: event.data });
  }
);

const app = new Hono();

// 3. Rotta Inngest
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: process.env.INNGEST_SIGNING_KEY,
  });
  return handler(c);
});

app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server pronto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
