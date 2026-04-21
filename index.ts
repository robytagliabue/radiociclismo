import { Mastra, createNodeMiddleware } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

export const mastra = new Mastra({
  agents: { cyclingAgent },
  workflows: { cyclingWorkflow },
});

export default async function handler(req: any, res: any) {
  const url = req.url || '';

  // Gestione API Mastra
  if (url.includes('/api/')) {
    const middleware = createNodeMiddleware(mastra);
    return await middleware(req, res);
  }

  // Dashboard di Controllo
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head><title>Radiociclismo Control</title></head>
    <body style="font-family:sans-serif; padding:50px;">
      <h1>🚴‍♂️ Radiociclismo AI Control</h1>
      <input type="text" id="url" placeholder="URL ProCyclingStats" style="width:100%; padding:10px; margin-bottom:10px;">
      <button onclick="run()" style="padding:10px 20px; cursor:pointer;">Genera Articolo</button>
      <p id="status"></p>
      <script>
        async function run() {
          const url = document.getElementById('url').value;
          document.getElementById('status').innerText = 'Inviato...';
          await fetch('/api/workflows/cycling-sync/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: { raceUrl: url, raceName: 'Gara' } })
          });
          document.getElementById('status').innerText = 'Workflow Avviato!';
        }
      </script>
    </body>
    </html>
  `);
}
