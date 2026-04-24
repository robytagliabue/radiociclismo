import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

// 1. Inizializzazione Mastra (Solo per Agent e Workflow)
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// 2. CREAZIONE MANUALE DEL CLIENT INNGEST
// Questo risolve l'errore "undefined" perché lo creiamo noi qui
const inngest = new Inngest({ 
  id: 'radiociclismo-ai' 
});

// Trasformiamo il workflow in una funzione che Inngest capisce
const cyclingFn = cyclingWorkflow.getInngestFunction();

const app = new Hono();

// 3. ROTTA INNGEST (Usando il pacchetto ufficiale Inngest per Hono)
app.all('/api/inngest', (c) => {
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: process.env.INNGEST_SIGNING_KEY,
  });
  return handler(c);
});

// Rotta di test
app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

// 4. Avvio Server
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server in ascolto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
