import { Mastra, createNodeMiddleware } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

export const mastra = new Mastra({
  agents: { cyclingAgent },
  workflows: { cyclingWorkflow },
});

export default async function handler(req: any, res: any) {
  const url = req.url || '';

  // 1. GESTIONE API (Per far funzionare il bot)
  if (url.includes('/api/')) {
    const middleware = createNodeMiddleware(mastra);
    return await middleware(req, res);
  }

  // 2. LA TUA DASHBOARD (Interfaccia Grafica)
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Radiociclismo AI Control</title>
        <style>
          body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; line-height: 1.6; background: #f4f4f9; }
          .card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          input, select { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
          button { background: #0070f3; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; width: 100%; font-size: 16px; font-weight: bold; }
          button:hover { background: #0051bb; }
          .status { margin-top: 20px; padding: 15px; border-radius: 6px; display: none; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🚴‍♂️ Radiociclismo AI</h1>
          <p>Inserisci l'URL di ProCyclingStats per generare l'articolo.</p>
          
          <input type="text" id="raceUrl" placeholder="https://www.procyclingstats.com/race/..." required>
          <input type="text" id="raceName" placeholder="Nome Gara (es. Amstel Gold Race)">
          
          <select id="gender">
            <option value="M">Uomini (Men Elite)</option>
            <option value="W">Donne (Women Elite)</option>
          </select>

          <button onclick="startSync()">Genera e Pubblica</button>
          
          <div id="statusBox" class="status"></div>
        </div>

        <script>
          async function startSync() {
            const btn = document.querySelector('button');
            const statusBox = document.getElementById('statusBox');
            const raceUrl = document.getElementById('raceUrl').value;
            const raceName = document.getElementById('raceName').value;
            
            if(!raceUrl) return alert('Inserisci un URL!');

            btn.disabled = true;
            btn.innerText = 'Agente in corsa...';
            statusBox.style.display = 'block';
            statusBox.style.background = '#eef';
            statusBox.innerText = 'L\'agente sta analizzando i dati e verificando i duplicati...';

            try {
              const response = await fetch('/api/workflows/cycling-sync/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  input: { raceUrl, raceName: raceName || 'Gara Ciclismo' }
                })
              });
              
              const data = await response.json();
              statusBox.style.background = '#dfd';
              statusBox.innerText = 'Successo! Workflow avviato con ID: ' + (data.runId || 'OK');
            } catch (err) {
              statusBox.style.background = '#fdd';
              statusBox.innerText = 'Errore durante l\\'invio.';
            } finally {
              btn.disabled = false;
              btn.innerText = 'Genera e Pubblica';
            }
          }
        </script>
      </body>
      </html>
    `);
  }
}
