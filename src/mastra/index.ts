import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

// 1. Mastra
export const mastra = new Mastra({
  id: 'radiociclismo',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// 2. Inngest
const inngest = new Inngest({ id: 'radiociclismo' });

/**
 * 3. DEFINIZIONE FUNZIONE (SINTASSI CORRETTA)
 * L'id e i triggers DEVONO stare nello stesso oggetto (il primo argomento).
 */
const cyclingFn = inngest.createFunction(
  { 
    id: 'cycling-workflow', 
    name: 'Cycling Workflow',
    // I triggers vanno qui dentro!
    triggers: [{ event: 'mastra/workflow.cyclingWorkflow.run' }] 
  },
  // Il secondo argomento è SOLO la funzione
  async ({ event }) => {
    const workflow = mastra.getWorkflow('cyclingWorkflow');
    return await workflow.execute({ input: event.data });
  }
);

const app = new Hono();

// 4. Rotta Inngest
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  // SOSTITUISCI CON LA TUA CHIAVE REALE
  const MY_SIGNING_KEY = "sign-nm-xxxxxxxxxxxxxxxxxxxx"; 
  
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingFn],
    signingKey: process.env.INNGEST_SIGNING_KEY || MY_SIGNING_KEY,
  });
  
  return handler(c);
});

app.get('/', (c) => c.text('Radiociclismo AI - Engine Online 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server radiociclismo attivo sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
