import { Mastra } from '@mastra/core';
import { createHonoServer } from '@mastra/core/server'; // Questo è il pezzo mancante!
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

// Inizializza Mastra
const mastra = new Mastra({
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// Crea il server Hono usando Mastra
const app = createHonoServer(mastra);

// Leggi la porta di Railway
const port = parseInt(process.env.PORT || '3000', 10);

// Avvia il server
console.log(`🚀 Avvio server sulla porta ${port}...`);

export default {
  port,
  fetch: app.fetch,
};

// Per far sì che TSX lo tenga acceso su Railway
import { serve } from '@hono/node-server';
serve({
  fetch: app.fetch,
  port: port,
});
