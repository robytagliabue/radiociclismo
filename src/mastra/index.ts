import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// 1. Inizializzazione di Mastra
// L'ID deve corrispondere a quello che Inngest si aspetta
export const mastra = new Mastra({
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// 2. Creazione del server Hono
const app = new Hono();

/**
 * Questa è la rotta magica. 
 * Invece di scrivere noi la risposta, usiamo il gestore di Mastra
 * che "parla" perfettamente la lingua di Inngest.
 */
app.all('/api/inngest', async (c) => {
  const handler = mastra.getInngestHandler();
  return handler(c.req.raw); 
});

/**
 * Rotta di cortesia per vedere se il server è vivo
 */
app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

// 3. Porta e Avvio
const port = Number(process.env.PORT) || 8080;

console.log(`🚀 Server in fuga sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
