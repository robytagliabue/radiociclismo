import { mastra as MastraApp } from 'mastra';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

export const mastra = new MastraApp({
  agents: { cyclingAgent },
  workflows: { cyclingWorkflow },
});
export default async function handler(req: any, res: any) {
  const url = req.url || '';

  if (url.includes('/api/')) {
    const middleware = createNodeMiddleware(mastra);
    return await middleware(req, res);
  }

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
    <!DOCTYPE html>
    <html lang="it">
    <head>
      <meta charset="UTF-8">
      <title>Radiociclismo Control Panel</title>
      <style>
        body { font-family: sans-serif; max-width: 500px; margin: 50px auto; background: #f4f7f6; }
        .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
        input { width: 100%; padding: 10px; margin: 10px 0 20px 0; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #0070f3; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
        #status { margin-top: 20px; font-size: 14px; color: #666; display: none; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🚴‍♂️ Radiociclismo AI</h1>
        <label>URL ProCyclingStats</label>
        <input type="text" id="url" placeholder="https://www.procyclingstats.com/race/...">
        <label>Nome Gara</label>
        <input type="text" id="name" placeholder="Es. Amstel Gold Race">
        <button onclick="run()">Genera Articolo</button>
        <div id="status"></div>
      </div>
      <script>
        async function run() {
          const status = document.getElementById('status');
          const url = document.getElementById('url').value;
          const name = document.getElementById('name').value;
          if(!url) return alert('Inserisci un URL');
          
          status.style.display = 'block';
          status.innerText = 'Agente in corsa... analizzo dati e verifico duplicati.';
          
          try {
            const res = await fetch('/api/workflows/cycling-sync/execute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ input: { raceUrl: url, raceName: name || 'Gara Ciclismo' } })
            });
            const data = await res.json();
            status.innerText = 'Fatto! Articolo creato con ID: ' + (data.runId || 'OK');
          } catch (e) {
            status.innerText = 'Errore durante la generazione.';
          }
        }
      </script>
    </body>
    </html>
  `);
}

