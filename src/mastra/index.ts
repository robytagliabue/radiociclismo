import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

const app = new Hono();

// Client Inngest - Usiamo l'ID che Inngest si aspetta
const inngest = new Inngest({ id: 'radiociclismo-test' });

const dummyFn = inngest.createFunction(
  { 
    id: 'test-ping', 
    name: 'Test Ping',
    triggers: [{ event: 'test/ping' }] 
  },
  async () => { return { message: 'pong' }; }
);

// ROTTA PRECISA: Rispondiamo esattamente a quello che Inngest sta chiamando
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  console.log(`[INNGEST CALL] Ricevuto ${c.req.method} su /api/inngest`);
  
  const handler = serveInngest({
    client: inngest,
    functions: [dummyFn],
    // Assicurati che questa sia la signkey che hai visto prima
    signingKey: 'signkeyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  });
  
  return handler(c);
});

// Pagina di cortesia per vedere se il server è vivo
app.get('/', (c) => c.text('Server Radiociclismo: In ascolto su /api/inngest 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Online su porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
