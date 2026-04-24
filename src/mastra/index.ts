import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// 1. Inizializzazione di Mastra
const mastra = new Mastra({
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// 2. Creazione del server Hono
const app = new Hono();

/**
 * Rotta per Inngest: questa è quella che Railway 
 * e Inngest devono contattare.
 */
app.all('/api/inngest', async (c) => {
  return c.json({ 
    status: 'Radiociclismo AI Engine Active',
    timestamp: new Date().toISOString(),
    service: 'Mastra'
  });
});

/**
 * Rotta base per testare il browser
 */
app.get('/', (c) => {
  return c.text('Radiociclismo AI Bot is Running! 🚴‍♂️');
});

// 3. Gestione della porta (Priorità a 8080 come visto nei tuoi log)
const port = Number(process.env.PORT) || 8080;

// 4. Avvio del server fisico
console.log(`🚀 Radiociclismo AI in fuga sulla porta ${port}...`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0', // Obbligatorio per rendere il server visibile fuori dal container
}, (info) => {
  console.log(`✅ Server ascolta su http://${info.address}:${info.port}`);
});