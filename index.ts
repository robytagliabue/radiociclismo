import { Mastra } from '@mastra/core';
// Importiamo con .js per la compatibilità Vercel ESM
// Assicurati che i nomi file siano esatti (es. cyclingAgent.ts con la A maiuscola)
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

/**
 * Inizializzazione di Mastra
 * Qui registriamo l'agente e il workflow in modo che siano accessibili
 */
export const mastra = new Mastra({
  agents: {
    cyclingAgent,
  },
  workflows: {
    cyclingWorkflow,
  },
});

/**
 * EXPORT DI DEFAULT (Necessario per Vercel)
 * Questo risolve l'errore: "The default export must be a function or server"
 * Vercel ha bisogno di un punto di ingresso per rispondere alle chiamate HTTP.
 */
export default async function handler(req: any, res: any) {
  // Risposta di cortesia per confermare che il bot è attivo
  res.status(200).json({ 
    status: 'Radiociclismo AI Agent is Online',
    timestamp: new Date().toISOString(),
    engine: 'Mastra V2'
  });
}
