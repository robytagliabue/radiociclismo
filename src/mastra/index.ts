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

// 2. Rotta Inngest per Hono
app.all('/api/inngest', async (c) => {
  try {
    // Recuperiamo l'handler
    const handler = mastra.createInngestHandler();
    
    /**
     * CRUCIALE: In Hono dobbiamo passare la richiesta 
     * e gestire la risposta in modo che Inngest la riconosca.
     */
    const response = await handler(c.req.raw);
    return response;
    
  } catch (err) {
    console.error('❌ ERRORE CRITICO INNGEST:', err);
    return c.json({ 
      error: 'Inngest Error', 
      message: err instanceof Error ? err.message : String(err) 
    }, 500);
  }
});

// Rotta base
app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;

console.log(`🚀 Server in ascolto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
