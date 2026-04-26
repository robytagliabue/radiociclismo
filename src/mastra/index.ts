import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

// 1. Configurazione Mastra (ID aggiornato)
export const mastra = new Mastra({
  id: 'radiociclismo-engine-new',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

// 2. Client Inngest con ID nuovo
const inngest = new Inngest({ 
  id: 'radiociclismo-engine-new' 
});

// 3. Funzione aggiornata
const cyclingFn = inngest.createFunction(
  { 
    id: 'cycling-workflow-new', 
    name: 'Cycling Workflow New',
    triggers: [{ event: 'mastra/workflow.cyclingWorkflow.run' }] 
  },
  async ({ event }) => {
    const workflow = mastra.getWorkflow('cyclingWorkflow');
    return await workflow.execute({ input: event.data });
  }
);

app.get('/', (c) => c.text('Nuovo Motore Radiociclismo: Online 🚴‍♂️'));

// 4. Nuova rotta API
app.on(['GET', 'POST', 'PUT'], '/api/v1/sync', async (c) => {
  // NOTA: Non mettiamo la signingKey ora. 
  // Al primo Sync, Inngest ci dirà lui qual è la nuova chiave.
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
  });
  
  return handler(c);
});

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Ripartenza su porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
