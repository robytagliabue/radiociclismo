import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// 1. Inizializzazione di Mastra
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

// 2. Rotta Inngest corretta per Hono/Node
app.all('/api/inngest', async (c) => {
  try {
    // MODIFICA QUI: In molte versioni di Mastra si accede così
    const handler = mastra.createInngestHandler(); 
    return await handler(c.req.raw);
  } catch (err) {
    console.error('❌ Errore durante il sync con Inngest:', err);
    return c.json({ 
        error: 'Internal Server Error', 
        message: err instanceof Error ? err.message : String(err) 
    }, 500);
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
