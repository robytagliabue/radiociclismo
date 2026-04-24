import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serve as serveInngest } from 'inngest/hono'; // Importiamo il servitore specifico per Hono
import { Inngest } from 'inngest';

// 1. Inizializzazione Mastra
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// 2. Configurazione Inngest Diretta (Più robusta)
const inngest = new Inngest({ id: 'radiociclismo-ai' });

// Trasformiamo i workflow di Mastra in funzioni Inngest
const inngestFunctions = mastra.getWorkflowInngestFunctions();

const app = new Hono();

// 3. La Rotta Inngest usando il pacchetto ufficiale 'inngest/hono'
// Questo elimina ogni problema di "Handler non trovato"
app.use('/api/inngest', serveInngest({ 
  client: inngest, 
  functions: inngestFunctions 
}));

// Rotta di cortesia
app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

// 4. Avvio Server
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server in fuga sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
