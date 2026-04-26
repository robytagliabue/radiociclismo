import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

const app = new Hono();

// Client Inngest
const inngest = new Inngest({ id: 'radiociclismo-v6-core' });

/**
 * CORREZIONE CRUCIALE: 
 * L'errore dice che il secondo argomento deve essere la funzione.
 * Qui sotto la sintassi è quella esatta richiesta dall'SDK v3.
 */
const pingFn = inngest.createFunction(
  { 
    id: 'ping-v6', 
    name: 'Ping V6',
    triggers: [{ event: 'app/ping' }] // I trigger devono stare qui dentro
  },
  async () => { 
    return { message: 'Sintassi Corretta!' }; 
  }
);

app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  try {
    const handler = serveInngest({
      client: inngest,
      functions: [pingFn],
    });
    return await handler(c);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/', (c) => c.text('Debug Sintassi: Online 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
