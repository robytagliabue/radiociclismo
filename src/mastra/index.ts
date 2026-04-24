import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// 1. Inizializzazione Mastra
// Assicurati che cyclingWorkflow sia esportato correttamente nel suo file
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

const app = new Hono();

// 2. Rotta Inngest - La versione più semplice e documentata
app.all('/api/inngest', async (c) => {
  // In molte versioni di Mastra, l'handler si crea così:
  const handler = (mastra as any).createInngestHandler();
  return handler(c.req.raw);
});

// Rotta base
app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

// 3. Avvio Server
const port = Number(process.env.PORT) || 8080;

console.log(`🚀 Server pronto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
