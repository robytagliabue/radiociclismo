import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

/**
 * 1. CONFIGURAZIONE MASTRA
 */
export const mastra = new Mastra({
  id: 'radiociclismo',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

/**
 * 2. ROTTA DI TEST (Root)
 */
app.get('/', (c) => {
  return c.text('Radiociclismo Engine: Online 🚴‍♂️');
});

/**
 * 3. ROTTA INNGEST (API ENDPOINT)
 */
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  
  // --- CONFIGURAZIONE CHIAVE ---
  // Incolla qui la chiave "sign-nm-..." che trovi nelle Settings di Inngest
  const MY_HARDCODED_KEY = "sign-nm-INCOLLA_QUI_LA_TUA_CHIAVE"; 
  
  // Usiamo la variabile di Railway se presente, altrimenti quella scritta a mano
  const signingKey = process.env.INNGEST_SIGNING_KEY || MY_HARDCODED_KEY;

  // Inizializzazione dinamica del client per evitare crash allo startup
  const inngest = new Inngest({ 
    id: 'radiociclismo',
    eventKey: process.env.INNGEST_EVENT_KEY || 'no-key-yet'
  });

  // Definizione della funzione all'interno dell'handler
  const cyclingFn = inngest.createFunction(
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

  // Risposta rapida per i test da browser (GET)
  if (c.req.method === 'GET' && !c.req.header('x-inngest-signature')) {
    return c.json({
      status: "Running",
      app: "radiociclismo",
      key_detected: !!process.env.INNGEST_SIGNING_KEY || MY_HARDCODED_KEY !== "signkey-prod-8809b52b70d5a1184c6d0781b39aa96476ca53dc8d80a7b5faffd593c47b2e7e",
      message: "Pronto per il Sync di Inngest"
    });
  }

  // Handler ufficiale di Inngest
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: signingKey,
  });
  
  return handler(c);
});

/**
 * 4. AVVIO SERVER
 */
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server radiociclismo in corsa sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
