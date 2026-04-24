import { Mastra, Agent } from '@mastra/core';
// ed eventualmente
import { Workflow } from '@mastra/core/workflows';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

export const mastra = new (Mastra as any)({
  agents: { cyclingAgent },
  workflows: { cyclingWorkflow },
});

// Vercel handler
export default async function handler(req: any, res: any) {
  const url = req.url || '';
  
  if (url.includes('/api/')) {
    return res.status(200).json({ 
      status: 'Mastra Engine Active', 
      engine: 'v3',
      timestamp: new Date().toISOString() 
    });
  }

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
    <html>
      <head><title>Radiociclismo AI</title></head>
      <body style="font-family:sans-serif; padding:40px; text-align:center; background:#f4f7f6;">
        <div style="background:white; padding:30px; border-radius:12px; display:inline-block; shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h1>🚴‍♂️ Radiociclismo AI Engine</h1>
          <p>Il motore Mastra è online e configurato correttamente.</p>
          <p style="color:green; font-weight:bold;">✅ STATO: CONNESSO</p>
          <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
          <small style="color:#666;">Pronto per analizzare ProCyclingStats</small>
        </div>
      </body>
    </html>
  `);
}
