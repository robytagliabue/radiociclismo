import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

// Torniamo all'ID originale per "sovrascrivere" se possibile
export const mastra = new Mastra({
  id: 'radiociclismo',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const inngest = new Inngest({ id: 'radiociclismo' });

const cyclingFn = inngest.createFunction(
  { 
    id: 'cycling-workflow', 
    name: 'Cycling Workflow',
    triggers: [{ event: 'mastra/workflow.cyclingWorkflow.run' }] 
  },
  async ({ event }) => {
    const workflow = mastra.getWorkflow('cyclingWorkflow');
    return await workflow.execute({ input: event.data });
  }
);

const app = new Hono();

app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: process.env.INNGEST_SIGNING_KEY,
  });
  
  return handler(c);
});

app.get('/', (c) => c.text('Radiociclismo AI - Aggiornamento in corso...'));

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
