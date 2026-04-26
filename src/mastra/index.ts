import { createServer } from 'node:http';
import { Hono } from 'hono';
import { Inngest } from 'inngest';
import { serve as inngestServe } from 'inngest/hono';

const app = new Hono();

const inngest = new Inngest({
  id: 'radiociclismo-v6-core',
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

const pingFn = inngest.createFunction(
  { id: 'ping-v6', name: 'Ping V6' },
  { event: 'app/ping' },
  async ({ event, step }) => {
    return { message: 'Pong! 🚴' };
  }
);

const inngestHandler = inngestServe({
  client: inngest,
  functions: [pingFn],
  serveHost: process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : undefined,
  servePath: '/api/inngest',
});

app.on(['GET', 'POST', 'PUT'], '/api/inngest', (c) => inngestHandler(c));

app.get('/', (c) =>
  c.json({
    status: 'online',
    service: 'RadioCiclismo AI Agent',
    version: 'v6',
    timestamp: new Date().toISOString(),
  })
);

const port = Number(process.env.PORT) || 8080;

// Usa fetch nativo di Hono con createServer
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
  }

  const body =
    req.method !== 'GET' && req.method !== 'HEAD'
      ? await new Promise<Buffer>((resolve) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(chunk));
          req.on('end', () => resolve(Buffer.concat(chunks)));
        })
      : undefined;

  const request = new Request(url, {
    method: req.method,
    headers,
    body: body?.length ? body : undefined,
  });

  const response = await app.fetch(request);

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`🚴 RadioCiclismo online sulla porta ${port}`);
});
