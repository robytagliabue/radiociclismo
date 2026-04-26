import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as serveInngest } from 'inngest/hono';

const app = new Hono();

/**
 * 1. CONFIGURAZIONE CLIENT
 * L'ID deve essere unico e coerente con il nuovo URL.
 */
const inngest = new Inngest({ 
  id: 'radiociclismo-v6-core' 
});

/**
 * 2. FUNZIONE DI TEST (Ping)
 * Questa serve a Inngest per confermare che il server risponde correttamente.
 */
const pingFn = inngest.createFunction(
  { 
    id: 'ping-v6-test', 
    name: 'Ping V6 Test',
    triggers: [{ event: 'app/ping' }] 
  },
  async () => { 
    return { 
      status: 'success', 
      message: 'Connessione stabilita con il nuovo URL v6',
      timestamp: new Date().toISOString() 
    }; 
  }
);

/**
 * 3. ROTTA PER INNGEST
 * Gestisce le chiamate da Inngest su /api/inngest
 */
app.on(['GET', 'POST', 'PUT'], '/api/inngest', async (c) => {
  console.log(`[INNGEST] Chiamata ${c.req.method} ricevuta su v6-core`);

  const handler = serveInngest({
    client: inngest,
    functions: [pingFn],
    // La signingKey viene letta automaticamente dalle variabili di Railway:
    // Assicurati di avere INNGEST_SIGNING_KEY impostata con la chiave di "radiociclismo-produzione"
  });
  
  return handler(c);
});

/**
 * 4. PAGINA DI CORTESIA
 */
app.get('/', (c) => {
  return c.text('Motore Radiociclismo v6-core: ATTIVO 🚴‍♂️');
});

const port = Number(process.env.PORT) || 8080;

console.log(`
  🚀 Server pronto!
  URL Principale: https://radiociclismo-v6-core.up.railway.app
  Inngest Endpoint: https://radiociclismo-v6-core.up.railway.app/api/inngest
`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
