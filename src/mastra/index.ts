import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serve as serveInngest } from 'inngest/hono';

// 1. Inizializzazione Mastra
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

// 2. Rotta Inngest - Usiamo il metodo integrato di Mastra che è più sicuro
app.all('/api/inngest', async (c) => {
  try {
    // Mastra ha un gestore interno già pronto, proviamo a usarlo direttamente
    const handler = mastra.createInngestHandler();
    return await handler(c.req.raw);
  } catch (err) {
    console.error('❌ ERRORE DURANTE IL HANDLER:', err);
    
    // Se fallisce, proviamo a ricostruire la risposta manualmente per Inngest
    return c.json({
      error: 'Inngest synchronization failed',
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
