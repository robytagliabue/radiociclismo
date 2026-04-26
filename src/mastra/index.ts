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
  id: 'radiociclismo-v5',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

/**
 * 2. ROTTA DI TEST (Root)
 */
app.get('/', (c) => c.text('Radiociclismo Engine: Online 🚴‍♂️'));

/**
 * 3. ROTTA INNGEST (Endpoint per il Sync)
 */
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  
  // -------------------------------------------------------------------------
  // [AZIONE]: Incolla qui la NUOVA Signing Key della NUOVA app su Inngest
  // -------------------------------------------------------------------------
  const MY_REAL_KEY = "signkey-prod-8809b52b70d5a1184c6d0781b39aa96476ca53dc8d80a7b5faffd593c47b2e7e"; 

  // Cambiando l'ID in v5, Inngest lo tratterà come un progetto vergine
  const inngest = new Inngest({ 
    id: 'radiociclismo-v5' 
  });

  const cyclingFn = inngest.createFunction(
    { 
      id: 'cycling-workflow-v5', 
      name: 'Cycling Workflow V5',
      triggers: [{ event: 'mastra/workflow.cyclingWorkflow.run' }] 
    },
    async ({ event }) => {
      const workflow = mastra.getWorkflow('cyclingWorkflow');
      return await workflow.execute({ input: event.data });
    }
  );

  // Debug per il browser
  if (c.req.method === 'GET' && !c.req.header('x-inngest-signature')) {
    return c.json({
      status: "Running",
      app_id: "radiociclismo-v5",
      key_present: MY_REAL_KEY.startsWith("sign-nm-"),
      instructions: "Se key_present è true, vai su Inngest e registra questa NUOVA app"
    });
  }

  // Handler configurato per ignorare i fallback delle vecchie app
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: MY_REAL_KEY,
    signingKeyFallback: undefined, // Ignora esplicitamente le chiavi passate
  });
  
  return handler(c);
});

/**
 * 4. AVVIO SERVER
 */
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server radiociclismo-v5 attivo sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
