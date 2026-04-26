import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as inngestServe } from 'inngest/hono';

const app = new Hono();

// ─── Client Inngest ───────────────────────────────────────────────────────────
const inngest = new Inngest({
  id: 'radiociclismo-v6-core',
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

// ─── Funzione Ping (test) ─────────────────────────────────────────────────────
const pingFn = inngest.createFunction(
  { id: 'ping-v6', name: 'Ping V6' },
  { event: 'app/ping' },
  async ({ event, step }) => {
    return { message: 'Pong! RadioCiclismo operativo 🚴' };
  }
);

// ─── Funzione: Genera Articolo ────────────────────────────────────────────────
const generaArticoloFn = inngest.createFunction(
  { id: 'genera-articolo', name: 'Genera Articolo Ciclismo' },
  { event: 'radiociclismo/articolo.richiesto' },
  async ({ event, step }) => {
    const { titolo, tipo, gara } = event.data;

    const dati = await step.run('raccogli-dati', async () => {
      return {
        gara: gara ?? 'Giro d\'Italia',
        tipo: tipo ?? 'reportage',
        timestamp: new Date().toISOString(),
      };
    });

    const articolo = await step.run('genera-testo', async () => {
      const testo = `
        Titolo: ${titolo ?? 'Tappa emozionante al ' + dati.gara}
        Tipo: ${dati.tipo}
        Generato il: ${dati.timestamp}
        
        [Testo generato dall'AI giornalista di RadioCiclismo]
      `;
      return { testo };
    });

    await step.run('salva-articolo', async () => {
      console.log('📰 Articolo pronto:', articolo.testo);
      return { salvato: true };
    });

    return {
      success: true,
      articolo: articolo.testo,
    };
  }
);

// ─── Handler Inngest ──────────────────────────────────────────────────────────
const inngestHandler = inngestServe({
  client: inngest,
  functions: [pingFn, generaArticoloFn],
});

// ─── Route Inngest ────────────────────────────────────────────────────────────
app.on(['GET', 'POST', 'PUT'], '/api/inngest', (c) => inngestHandler(c));

// ─── Debug variabili d'ambiente ───────────────────────────────────────────────
app.get('/debug', (c) => {
  return c.json({
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ? '✅ presente' : '❌ mancante',
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY ? '✅ presente' : '❌ mancante',
    PORT: process.env.PORT ?? '❌ mancante',
    RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN ?? '❌ mancante',
  });
});

// ─── Trigger manuale articolo (test) ─────────────────────────────────────────
app.post('/trigger/articolo', async (c) => {
  try {
    const body = await c.req.json();
    await inngest.send({
      name: 'radiociclismo/articolo.richiesto',
      data: {
        titolo: body.titolo ?? null,
        tipo: body.tipo ?? 'reportage',
        gara: body.gara ?? 'Giro d\'Italia',
      },
    });
    return c.json({ success: true, message: 'Articolo in generazione... 🚴' });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/', (c) => {
  return c.json({
    status: 'online',
    service: 'RadioCiclismo AI Journalist',
    version: 'v6',
    timestamp: new Date().toISOString(),
  });
});

// ─── Avvio server ─────────────────────────────────────────────────────────────
const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
console.log(`🚴 RadioCiclismo AI Agent online sulla porta ${port}`);