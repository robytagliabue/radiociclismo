import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

// 1. Mastra lo carichiamo subito (non dà problemi)
export const mastra = new Mastra({
  id: 'radiociclismo',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

/**
 * 2. ROTTA DI TEST (Se questa risponde, il server è vivo)
 */
app.get('/', (c) => c.text('Radiociclismo Engine: Online 🚴‍♂️'));

/**
 * 3. ROTTA INNGEST (Inizializzazione dinamica)
 */
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  const signingKey = process.env.INNGEST_SIGNING_KEY;

  // Inizializziamo Inngest QUI DENTRO, così se manca la chiave all'avvio il server non muore
  const inngest = new Inngest({ 
    id: 'radiociclismo',
    eventKey: process.env.INNGEST_EVENT_KEY || 'no-key'
  });

  const cyclingFn = inngest.createFunction(
    { id: 'cycling-workflow', name: 'Cycling Workflow', triggers: [{ event: 'mastra/workflow.cyclingWorkflow.run' }] },
    async ({ event }) => {
      const workflow = mastra.getWorkflow('cyclingWorkflow');
      return await workflow.execute({ input: event.data });
    }
  );

  // Se è un browser che curiosa
  if (c.req.method === 'GET' && !c.req.header('x-inngest-signature')) {
    return c.json({
        status: "Running",
        keyDetected: !!signingKey,
        env: process.env.NODE_ENV || 'not set'
    });
  }

  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: signingKey,
  });
  
  return handler(c);
});

/**
 * 4. AVVIO SERVER (Blindato)
 */
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Avvio server sulla porta ${port}...`);

try {
  serve({
    fetch: app.fetch,
    port: port,
    hostname: '0.0.0.0',
  });
} catch (err) {
  console.error("Errore fatale durante lo startup:", err);
}
