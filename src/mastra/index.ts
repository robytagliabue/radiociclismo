import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serve as serveInngest } from 'inngest/hono';
import { Inngest } from 'inngest';

// 1. Inizializzazione Mastra
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// 2. Inizializzazione Client Inngest
const inngestClient = new Inngest({ 
  id: 'radiociclismo-ai' 
});

const app = new Hono();

// 3. Rotta Inngest - DEFINITIVA
app.all('/api/inngest', async (c) => {
  // Trasformiamo il workflow in funzione Inngest in modo esplicito
  const cyclingInngestFn = cyclingWorkflow.getInngestFunction();

  const handler = serveInngest({
    client: inngestClient,
    functions: [cyclingInngestFn], // La passiamo direttamente qui
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
