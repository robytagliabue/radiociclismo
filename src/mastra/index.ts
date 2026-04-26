import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

const app = new Hono();

// 1. Client base
const inngest = new Inngest({ id: 'radiociclismo-test' });

/**
 * 2. FUNZIONE CORRETTA
 * Il primo argomento contiene ID e Triggers. 
 * Il secondo argomento è la funzione (handler).
 */
const dummyFn = inngest.createFunction(
  { 
    id: 'test-ping', 
    name: 'Test Ping',
    triggers: [{ event: 'test/ping' }] // I trigger vanno qui dentro!
  },
  async () => { 
    return { message: 'pong' }; 
  }
);

app.get('/', (c) => c.text('Server di Test Corretto: Online 🚴‍♂️'));

app.on(['GET', 'POST', 'PUT'], '/api/v1/sync', async (c) => {
  try {
    const handler = serveInngest({
      client: inngest,
      functions: [dummyFn],
    });
    return await handler(c);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server in ascolto su porta ${port}`);

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
