import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

const app = new Hono();

// Client base senza fronzoli
const inngest = new Inngest({ id: 'radiociclismo-test' });

// Funzione finta (senza Mastra)
const dummyFn = inngest.createFunction(
  { id: 'test-ping', name: 'Test Ping' },
  { event: 'test/ping' },
  async () => { return { message: 'pong' }; }
);

app.get('/', (c) => c.text('Server di Test Online 🚴‍♂️'));

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
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
