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

// 2. Rotta Inngest - La versione corretta per le nuove API
app.all('/api/inngest', async (c) => {
  try {
    // Cerchiamo l'handler dove Mastra lo mette nelle versioni recenti
    const handler = (mastra as any).inngest?.createHandler?.() || 
                    (mastra as any).createInngestHandler?.();

    if (!handler) {
      throw new Error('Nessun handler Inngest trovato in Mastra. Controlla la versione.');
    }

    return await handler(c.req.raw);
  } catch (err) {
    console.error('❌ Errore Inngest:', err);
    return c.json({ 
      error: 'Inngest Handler Error', 
      details: err instanceof Error ? err.message : String(err) 
    }, 500);
  }
});

app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server pronto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
