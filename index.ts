import { Mastra } from '@mastra/core';
// Utilizziamo l'estensione .js per la compatibilità con l'ambiente Vercel ESM
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

/**
 * Inizializzazione della piattaforma Mastra
 * Registriamo l'agente e il workflow per renderli operativi
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
 * HANDLER DI DEFAULT (Fondamentale per Vercel)
 * Questo risolve l'errore "The default export must be a function or server".
 * Senza questo blocco, Vercel non sa come "rispondere" alle chiamate web.
 */
const handler = async (req: any, res: any) => {
  // Risposta di test per verificare che il bot sia online
  return res.status(200).json({ 
    status: 'Radiociclismo AI Engine Online',
    message: 'Mastra Agent is ready to process race data',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
};

export default handler;
