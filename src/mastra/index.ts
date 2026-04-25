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
  id: 'radiociclismo', // Allineato al nome app
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

/**
 * 2. CONFIGURAZIONE INNGEST
 * L'ID DEVE essere 'radiociclismo'
 */
const inngest = new Inngest({ 
  id: 'radiociclismo' 
});

/**
 * 3. DEFINIZIONE FUNZIONE
 */
const cyclingFn = inngest.createFunction(
  { 
    id: 'cycling-workflow', 
    name: 'Cycling Workflow' 
  },
  { event: 'mastra/workflow.cyclingWorkflow.run' },
  async ({ event }) => {
    const workflow = mastra.getWorkflow('cyclingWorkflow');
    return await workflow.execute({ input: event.data });
  }
);

const app = new Hono();

/**
 * 4. ROTTA INNGEST (Il "Ponte")
 */
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  // --- INCOLLA QUI LA TUA CHIAVE REALE ---
  const MY_SIGNING_KEY = "signkey-prod-8809b52b70d5a1184c6d0781b39aa96476ca53dc8d80a7b5faffd593c47b2e7e"; 
  
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: process.env.INNGEST_SIGNING_KEY || MY_SIGNING_KEY,
  });
  
  return handler(c);
});

/**
 * 5. ROOT E TEST
 */
app.get('/', (c) => c.text('Radiociclismo AI - Engine Online 🚴‍♂️'));

/**
 * 6. AVVIO
 */
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server radiociclismo attivo sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
