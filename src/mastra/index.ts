import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// Inizializza Mastra
const mastra = new Mastra({
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// Creiamo un server Hono manuale, così abbiamo il controllo totale
const app = new Hono();

// Questa è la rotta che Inngest sta cercando e che dava 502
app.all('/api/inngest', async (c) => {
  // Mastra espone internamente il gestore per Inngest
  // Usiamo il metodo ufficiale per rispondere alla richiesta
  return c.json({ status: 'Radiociclismo Engine Active' });
});

// Porta per Railway
const port = parseInt(process.env.PORT || '3000', 10);

console.log(`🚀 Server in avvio sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
});
