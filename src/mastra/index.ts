import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent';
import { cyclingWorkflow } from './cyclingWorkflow';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// 1. Inizializzazione esplicita
export const mastra = new Mastra({
  // Diamo un ID chiaro all'app
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

// 2. Rotta Inngest con gestione degli errori
app.all('/api/inngest', async (c) => {
  try {
    const handler = mastra.getInngestHandler();
    // Importante: passiamo la richiesta e Mastra si occupa del resto
    return await handler(c.req.raw);
  } catch (err) {
    // Se c'è un errore 500, lo vedremo nei log di Railway
    console.error('❌ Errore durante il sync con Inngest:', err);
    return c.json({ error: 'Internal Server Error', message: err instanceof Error ? err.message : String(err) }, 500);
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
