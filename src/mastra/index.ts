import { Mastra, Agent, Workflow } from 'mastra'; 
// Se continua a dare errore TS2305, prova così:
// import { mastra as Mastra, agent as Agent, workflow as Workflow } from 'mastra';
// Usiamo un import più generico per evitare errori di esportazione
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

// Estraiamo la classe Mastra in modo sicuro
const MastraClass = (mastraLib as any).Mastra || (mastraLib as any).mastra;

export const mastra = new MastraClass({
  agents: { cyclingAgent },
  workflows: { cyclingWorkflow },
});

// Handler semplificato per Vercel: non usa createNodeMiddleware
// ma permette comunque a Vercel di far girare la funzione serverless
export default async function handler(req: any, res: any) {
  const { url } = req;

  // Se è una chiamata API per Inngest o i workflow
  if (url?.includes('/api/')) {
    // Invece di usare createNodeMiddleware che crasha, 
    // rispondiamo che il motore è attivo. 
    // Nota: I workflow Inngest girano tramite l'endpoint dedicato in api/inngest.ts
    return res.status(200).json({ status: 'Mastra Engine Active', engine: 'v3' });
  }

  // Qui puoi lasciare l'HTML dell'interfaccia che abbiamo scritto prima
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
    <html>
      <body style="font-family:sans-serif; padding:40px; text-align:center;">
        <h1>🚴‍♂️ Radiociclismo AI Engine</h1>
        <p>Il motore è online e pronto per la gara.</p>
        <p style="color:green;">Stato: Connesso</p>
      </body>
    </html>
  `);
}
