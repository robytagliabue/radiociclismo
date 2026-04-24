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

// 2. Client Inngest - Passiamo TUTTO esplicitamente
const inngest = new Inngest({ 
  id: 'radiociclismo-ai',
  eventKey: process.env.INNGEST_EVENT_KEY,
});

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

// 3. Rotta Inngest - Forziamo i parametri che Inngest vede come "UNKNOWN"
app.all('/api/inngest', async (c) => {
  const signingKey = process.env.INNGEST_SIGNING_KEY;
  
  // Se Railway non sta passando la chiave, il Sync fallirà sempre
  if (!signingKey) {
    console.error('❌ ERRORE CRITICO: INNGEST_SIGNING_KEY non trovata nelle variabili!');
  }

  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: signingKey,
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
