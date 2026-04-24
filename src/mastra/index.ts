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

// 2. Rotta Inngest - LA VERSIONE DIRETTA
// Usiamo l'handler integrato di Mastra ma lo chiamiamo correttamente per Hono
app.all('/api/inngest', async (c) => {
  try {
    // Mastra genera un handler standard. Lo chiamiamo passando la richiesta raw.
    const handler = (mastra as any).createInngestHandler();
    
    // IMPORTANTE: Dobbiamo restituire la risposta che l'handler genera
    return await handler(c.req.raw);
  } catch (err) {
    console.error('❌ Errore critico nel Sync:', err);
    return c.json({ 
      success: false, 
      error: err instanceof Error ? err.message : 'Unknown error' 
    }, 500);
  }
});

app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

// 3. Avvio Server
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server pronto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
