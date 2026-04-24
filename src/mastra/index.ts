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
 * 2. Rotta Inngest - Approccio Dinamico
 * Se la funzione non esiste come proprietà, la cerchiamo 
 * usando il metodo di creazione dell'handler di Mastra.
 */
app.all('/api/inngest', async (c) => {
  try {
    // Proviamo a recuperare l'handler in modo super protetto
    const handler = typeof (mastra as any).createInngestHandler === 'function' 
      ? (mastra as any).createInngestHandler() 
      : (mastra as any).inngest.createHandler();

    return await handler(c.req.raw);
  } catch (err) {
    console.error('❌ Errore Inngest:', err);
    return c.json({ 
        error: 'Inngest interface not found', 
        message: 'Verifica la versione di Mastra e le integrazioni' 
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
