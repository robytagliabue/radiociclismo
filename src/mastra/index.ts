import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

// 1. Mastra
export const mastra = new Mastra({
  id: 'radiociclismo',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// 2. Inngest - Usiamo una chiave fake se manca quella reale per evitare il crash
const inngest = new Inngest({ 
  id: 'radiociclismo',
  eventKey: process.env.INNGEST_EVENT_KEY || 'local_key'
});

// 3. Funzione
const cyclingFn = inngest.createFunction(
  { id: 'cycling-workflow', name: 'Cycling Workflow', triggers: [{ event: 'mastra/workflow.cyclingWorkflow.run' }] },
  async ({ event }) => {
    const workflow = mastra.getWorkflow('cyclingWorkflow');
    return await workflow.execute({ input: event.data });
  }
);

const app = new Hono();

// 4. Rotta Inngest - AGGIORNATA PER IL DEBUG
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  const key = process.env.INNGEST_SIGNING_KEY;

  // Se è un browser (GET), mostriamo uno stato invece di far rispondere l'SDK
  if (c.req.method === 'GET' && !c.req.header('x-inngest-signature')) {
    return c.json({
      status: "Running",
      app: "radiociclismo",
      hasKey: !!key,
      message: "Pronto per il Sync di Inngest"
    });
  }

  try {
    const handler = serveInngest({
      client: inngest,
      functions: [cyclingFn],
      signingKey: key,
    });
    return await handler(c);
  } catch (err: any) {
    console.error("ERRORE INNGEST HANDLER:", err);
    return c.json({ error: "Handler Error", details: err.message }, 500);
  }
});

app.get('/', (c) => c.text('Radiociclismo Engine: Online 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
