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
  id: 'radiociclismo',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

/**
 * 2. CONFIGURAZIONE INNGEST
 * Rileviamo se siamo in produzione su Railway per evitare il messaggio "In cloud mode but no signing key"
 */
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PUBLIC_DOMAIN;

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
  const signingKey = process.env.INNGEST_SIGNING_KEY;

  // Log di controllo visibile su Railway
  console.log(`--- [INNGEST CALL] Metodo: ${c.req.method} ---`);
  if (!signingKey) {
    console.warn('⚠️ Attenzione: INNGEST_SIGNING_KEY non rilevata dal processo Node!');
  }

  const handler = serveInngest({
    client: inngest,
    functions: [cyclingInngestFn],
    signingKey: signingKey,
    // Se la chiave manca, proviamo a forzare isDev solo per non dare 500 immediato nel Sync iniziale
    isDev: !signingKey && !isProduction,
  });
  
  return handler(c);
});

/**
 * 5. ROTTA DI TEST E ROOT
 */
app.get('/', (c) => {
  return c.text(`Radiociclismo AI attivo! Ambiente: ${isProduction ? 'Produzione' : 'Sviluppo'}`);
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