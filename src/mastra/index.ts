import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

export const mastra = new Mastra({
  id: 'radiociclismo',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

app.get('/', (c) => c.text('Radiociclismo Engine: Online 🚴‍♂️'));

app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  // 1. LA CHIAVE: Assicurati che inizi con "sign-nm-"
  const MY_REAL_KEY = "signkey-prod-8809b52b70d5a1184c6d0781b39aa96476ca53dc8d80a7b5faffd593c47b2e7e"; 

  console.log(`[INNGEST] Ricevuta richiesta ${c.req.method}`);

  const inngest = new Inngest({ 
    id: 'radiociclismo' 
  });

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

  // Se è un browser (GET), diamo conferma
  if (c.req.method === 'GET' && !c.req.header('x-inngest-signature')) {
    return c.json({
      status: "Running",
      app: "radiociclismo",
      key_present: MY_REAL_KEY.startsWith("sign-nm-") && MY_REAL_KEY.length > 20
    });
  }

  try {
    const handler = serveInngest({
      client: inngest,
      functions: [cyclingFn],
      signingKey: MY_REAL_KEY,
    });
    return await handler(c);
  } catch (err: any) {
    // Questo log su Railway ci dirà la verità se esce 500
    console.error("--- ERRORE CRITICO INNGEST ---");
    console.error(err.message);
    return c.json({ error: err.message }, 500);
  }
});

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
