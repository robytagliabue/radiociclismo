import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serve as serveInngest } from 'inngest/hono';
import { Inngest } from 'inngest';

// 1. Inizializzazione Mastra
export const mastra = new Mastra({
  id: 'radiociclismo-ai',
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

/**
 * 2. Inizializzazione MANUALE del client Inngest
 * Questo risolve l'errore 'apiBaseUrl' di undefined
 */
const inngestClient = new Inngest({ 
  id: 'radiociclismo-ai'
});

const app = new Hono();

// 3. Rotta Inngest corretta
app.all('/api/inngest', async (c) => {
  // Prendiamo le funzioni dal workflow
  const functions = (mastra as any).getWorkflowInngestFunctions?.() || [];
  
  const handler = serveInngest({
    client: inngestClient,
    functions: functions,
    signingKey: process.env.INNGEST_SIGNING_KEY, // Passiamo la chiave esplicitamente
  });
  
  return handler(c);
});

// Rotta base
app.get('/', (c) => c.text('Radiociclismo AI is LIVE! 🚴‍♂️'));

// 4. Avvio Server
const port = Number(process.env.PORT) || 8080;
console.log(`🚀 Server in ascolto sulla porta ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0',
});
