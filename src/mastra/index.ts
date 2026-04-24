import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

// 1. Inizializzazione Mastra
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// 2. Client Inngest Manuale
const inngest = new Inngest({ id: 'radiociclismo-ai' });

/**
 * Trasformiamo il workflow in una funzione Inngest.
 * Usiamo 'any' per evitare blocchi di TypeScript e andiamo diretti al sodo.
 */
const cyclingInngestFn = (cyclingWorkflow as any).getInngestFunction 
  ? (cyclingWorkflow as any).getInngestFunction()
  : inngest.createFunction(
      { id: 'cycling-workflow' },
      { event: 'mastra/workflow.cyclingWorkflow.run' },
      async ({ event, step }) => {
        return await cyclingWorkflow.execute({ input: event.data });
      }
    );

const app = new Hono();

// 3. Rotta Inngest - Usiamo il server ufficiale di Inngest
app.all('/api/inngest', async (c) => {
  const handler = serveInngest({
    client: inngest,
    functions: [cyclingInngestFn],
    signingKey: process.env.INNGEST_SIGNING_KEY,
  });
  return handler(c);
});

app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server pronto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
