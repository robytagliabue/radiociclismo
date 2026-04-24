import { Mastra } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

// Inizializza Mastra
const mastra = new Mastra({
  agents: [cyclingAgent],
  workflows: [cyclingWorkflow],
});

// DEFINISCI LA PORTA (fondamentale per Railway)
const port = parseInt(process.env.PORT || '3000', 10);

// AVVIA IL SERVER
mastra.listen({
  port: port,
  callback: (p) => {
    console.log(`🚀 Radiociclismo AI Engine pronto sulla porta ${p}`);
  },
});
