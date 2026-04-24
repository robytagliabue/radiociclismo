import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

/**
 * 1. INIZIALIZZAZIONE MASTRA
 */
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

/**
 * 2. CONFIGURAZIONE INNGEST
 * Passiamo l'Event Key esplicitamente. Se non la trova, userà una stringa vuota 
 * per evitare il crash, ma il log ci avviserà.
 */
const inngest = new Inngest({ 
  id: 'radiociclismo-ai',
  eventKey: process.env.INNGEST_EVENT_KEY || '',
});

/**
 * 3. DEFINIZIONE FUNZIONE (Sintassi Rigida v4)
 */
const cyclingInngestFn = inngest.createFunction(
  { 
    id: 'cycling-workflow', 
    name: 'Cycling Workflow',
    triggers: [{ event: 'mastra/workflow.cyclingWorkflow.run' }] 
  },
  async ({ event }) => {
    const workflow = mastra.getWorkflow('cyclingWorkflow');
    return await workflow.execute({ input: event.data });
  }
);

const app = new Hono();

/**
 * 4. ROTTA INNGEST CON DEBUG INTEGRATO
 */
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  const signingKey = process.env.INNGEST_SIGNING_KEY;
  const envMode = process.env.NODE_ENV || 'development';

  // LOG DI EMERGENZA: Vedrai questi nei log di Railway durante il Sync
  console.log('--- [DEBUG INNGEST] ---');
  console.log(`Metodo: ${c.req.method}`);
  console.log(`Ambiente: ${envMode}`);
  console.log(`Chiave Signing presente: ${!!signingKey}`);
  if (!signingKey) {
    console.error('❌ ERRORE: La INNGEST_SIGNING_KEY è assente su Railway!');
  }
  console.log('-----------------------');

  const handler = serveInngest({
    client: inngest,
    functions: [cyclingInngestFn],
    signingKey: signingKey,
  });
  
  return handler(c);
});

/**
 * 5. ROTTA DI TEST
 */
app.get('/', (c) => {
  return c.text(`Radiociclismo AI is LIVE! Port: ${process.env.PORT || 8080}`);
});

/**
 * 6. AVVIO SERVER
 */
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server in fuga sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
