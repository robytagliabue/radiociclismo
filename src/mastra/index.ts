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
 */
const inngest = new Inngest({ 
  id: 'radiociclismo',
  eventKey: process.env.INNGEST_EVENT_KEY,
});

/**
 * 3. DEFINIZIONE FUNZIONE WORKFLOW
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
 * 4. ROTTA PER INNGEST (API ENDPOINT)
 */
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  // --- CONFIGURAZIONE CHIAVE ---
  // Incolla la tua chiave tra le virgolette se process.env non funziona
  const backupKey = "ZBIXQQtGnbIYUl9wlJiXOri0K2HRW7M5NVLr5YfEoWXBa4mFJhb8PnI6226LRkOMqc-RcvUEy4w5B3HyOQFRqA"; 
  const signingKey = process.env.INNGEST_SIGNING_KEY || backupKey;

  console.log(`--- [INNGEST CALL] Metodo: ${c.req.method} ---`);
  console.log(`Chiave Signing rilevata: ${!!process.env.INNGEST_SIGNING_KEY}`);

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
  return c.text(`Radiociclismo AI attivo! Porta: ${process.env.PORT || 8080}`);
});

/**
 * 6. AVVIO SERVER
 */
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server in ascolto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
