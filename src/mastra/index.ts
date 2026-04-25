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

// 2. Inngest - Disabilitiamo il check bloccante all'avvio
const inngest = new Inngest({ 
  id: 'radiociclismo',
  // Se la chiave non c'è, mettiamo una stringa vuota per evitare il crash immediato
  eventKey: process.env.INNGEST_EVENT_KEY || 'no-key-yet'
});

// 3. Funzione
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

// 4. Rotta Inngest
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  // Prendiamo la chiave che hai su Railway o usiamo una stringa per non far morire Hono
  const key = process.env.INNGEST_SIGNING_KEY;

  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: key,
    // Questo permette a Inngest di rispondere anche se la chiave è "instabile" durante il sync
    isDev: !key, 
  });
  
  return handler(c);
});

app.get('/', (c) => c.text('Radiociclismo Engine: Online 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;

// Log di conferma per Railway
console.log(`🚀 Tentativo di avvio su porta ${port}...`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
