import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// 1. Inizializzazione Mastra
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

/**
 * 2. Creazione dell'handler
 * Nelle versioni recenti si trova sotto mastra.inngest
 */
const inngestHandler = mastra.inngest.createHandler();

app.all('/api/inngest', async (c) => {
  try {
    return await inngestHandler(c.req.raw);
  } catch (err) {
    console.error('❌ Errore Inngest:', err);
    return c.json({ error: 'Inngest error', details: String(err) }, 500);
  }
});

app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server in ascolto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
