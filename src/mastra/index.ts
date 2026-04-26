import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

const app = new Hono();

// Client Inngest
const inngest = new Inngest({ id: 'radiociclismo-test' });

const dummyFn = inngest.createFunction(
  { id: 'test-ping', name: 'Test Ping', triggers: [{ event: 'test/ping' }] },
  async () => { return { message: 'pong' }; }
);

app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  console.log(`[DEBUG] Richiesta Inngest ricevuta: ${c.req.method}`);
  
  try {
    const handler = serveInngest({
      client: inngest,
      functions: [dummyFn],
      // PROVA 1: Se hai la chiave, incollala qui sotto. 
      // PROVA 2: Se dà ancora 500, commenta la riga signingKey e metti isDev: true
      signingKey: 'signkey-prod-8809b52b70d5a1184c6d0781b39aa96476ca53dc8d80a7b5faffd593c47b2e7e', 
      // isDev: true, 
    });
    
    return await handler(c);
  } catch (err: any) {
    console.error("[CRASH LOG]:", err.message);
    return c.json({ error: "Crash interno", details: err.message }, 500);
  }
});

app.get('/', (c) => c.text('Server Online 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
