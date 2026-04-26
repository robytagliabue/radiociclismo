import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

const app = new Hono();

// ─── Client Inngest ───────────────────────────────────────────────────────────
const inngest = new Inngest({ id: 'radiociclismo-v6-core' });

// ─── Funzione di test: Ping ───────────────────────────────────────────────────
const pingFn = inngest.createFunction(
  { id: 'ping-v6', name: 'Ping V6' },
  { event: 'app/ping' },
  async ({ event, step }) => {
    return { message: 'Pong! RadioCiclismo AI Agent operativo 🚴‍♂️' };
  }
);

// ─── Funzione: Genera articolo ciclismo ──────────────────────────────────────
const generaArticoloFn = inngest.createFunction(
  { id: 'genera-articolo', name: 'Genera Articolo Ciclismo' },
  { event: 'radiociclismo/articolo.richiesto' },
  async ({ event, step }) => {
    const { titolo, tipo, gara } = event.data;

    // Step 1: Raccolta dati (es. da API esterne o scraping)
    const dati = await step.run('raccogli-dati', async () => {
      // Qui in futuro puoi chiamare API sportive (es. FirstCycling, ProCyclingStats)
      return {
        gara: gara ?? 'Giro d\'Italia',
        tipo: tipo ?? 'reportage',
        timestamp: new Date().toISOString(),
      };
    });

    // Step 2: Generazione testo con AI (placeholder — collega il tuo LLM qui)
    const articolo = await step.run('genera-testo', async () => {
      // Esempio: chiamata a OpenAI / Anthropic / altro
      const testoGenerato = `
        Titolo: ${titolo ?? 'Tappa emozionante al ' + dati.gara}
        
        [Qui verrà inserito il testo generato dall'AI]
        
        Generato il: ${dati.timestamp}
      `;
      return { testo: testoGenerato };
    });

    // Step 3: Log / salvataggio (es. database, CMS)
    await step.run('salva-articolo', async () => {
      console.log('Articolo pronto:', articolo.testo);
      // Qui puoi salvare su Postgres, Notion, WordPress, ecc.
      return { salvato: true };
    });

    return {
      success: true,
      articolo: articolo.testo,
    };
  }
);

// ─── Route Inngest (GET + POST + PUT richiesti dall'SDK) ──────────────────────
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  try {
    const handler = serveInngest({
      client: inngest,
      functions: [pingFn, generaArticoloFn],
    });
    return await handler(c);
  } catch (err: any) {
    console.error('Inngest error:', err);
    return c.json({ error: err.message }, 500);
  }
});

// ─── Route di health check ────────────────────────────────────────────────────
app.get('/', (c) => {
  return c.json({
    status: 'online',
    service: 'RadioCiclismo AI Journalist',
    version: 'v6',
    timestamp: new Date().toISOString(),
  });
});

// ─── Route manuale per triggerare un articolo (utile per test) ───────────────
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
    return c.json({ success: true, message: 'Articolo in generazione...' });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Avvio server ─────────────────────────────────────────────────────────────
const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });

console.log(`🚴‍♂️ RadioCiclismo AI Agent in ascolto sulla porta ${port}`);
