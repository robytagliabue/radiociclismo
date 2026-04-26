import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

const app = new Hono();

// Client ultra-base
const inngest = new Inngest({ id: 'radiociclismo-v6-core' });

const pingFn = inngest.createFunction(
  { id: 'ping', name: 'Ping' },
  { event: 'app/ping' },
  async () => { return { ok: true }; }
);

app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  try {
    // Verifichiamo se la chiave esiste (Log su Railway)
    console.log("Chiave presente su Railway?", !!process.env.INNGEST_SIGNING_KEY);

    const handler = serveInngest({
      client: inngest,
      functions: [pingFn],
      // Se la chiave è corrotta, l'errore verrà catturato dal catch qui sotto
    });
    
    return await handler(c);
  } catch (err: any) {
    // Questo manderà l'errore VERO al browser e ai log di Railway
    console.error("ERRORE FATALE INNGEST:", err.message);
    return c.json({ 
      error: "Crash durante il Sync", 
      message: err.message,
      stack: err.stack 
    }, 500);
  }
});

app.get('/', (c) => c.text('Test Debug v6: Online 🚴‍♂️'));

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
