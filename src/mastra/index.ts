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

// 2. Rotta Inngest "Indistruttibile"
app.all('/api/inngest', async (c) => {
  try {
    // Proviamo i diversi modi in cui Mastra espone il gestore Inngest
    let handler;

    if (typeof (mastra as any).createInngestHandler === 'function') {
      handler = (mastra as any).createInngestHandler();
    } else if ((mastra as any).inngest && typeof (mastra as any).inngest.createHandler === 'function') {
      handler = (mastra as any).inngest.createHandler();
    } else {
      throw new Error('Impossibile trovare il gestore Inngest nell’oggetto Mastra');
    }

    return await handler(c.req.raw);
  } catch (err) {
    console.error('❌ Errore durante il sync con Inngest:', err);
    return c.json({ 
      error: 'Inngest Configuration Error', 
      details: err instanceof Error ? err.message : String(err) 
    }, 500);
  }
});

// Rotta di test per il browser
app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

// 3. Gestione Porta e Avvio
const port = Number(process.env.PORT) || 8080;

console.log(`🚀 Radiociclismo AI in fuga sulla porta ${port}...`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
}, (info) => {
  console.log(`✅ Server pronto su http://${info.address}:${info.port}`);
});
