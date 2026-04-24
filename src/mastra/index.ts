import { Mastra, createNodeMiddleware } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

// 1. Inizializzazione Mastra
export const mastra = new Mastra({
  agents: { cyclingAgent },
  workflows: { cyclingWorkflow },
});

// 2. Handler per l'interfaccia di controllo e API
export default async function handler(req: any, res: any) {
  const url = req.url || '';

  // Gestione rotte API di Mastra
  if (url.includes('/api/')) {
    const middleware = createNodeMiddleware(mastra);
    return await middleware(req, res);
  }

  // Interfaccia grafica (HTML)
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
    <!DOCTYPE html>
    <html lang="it">
    <head>
      <meta charset="UTF-8">
      <title>Radiociclismo Control Panel</title>
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 500px; margin: 50px auto; background: #f4f7f6; padding: 20px; }
        .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
        h1 { margin-top: 0; color: #333; }
        label { display: block; margin-bottom: 5px; font-weight: bold; font-size: 14px; }
        input { width: 100%; padding: 12px; margin: 0 0 20px 0; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; font-size: 16px; }
        button { width: 100%; padding: 14px; background: #0070f3; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #0051bb; }
        #status { margin-top: 20px; font-size: 14px; color: #666; padding: 10px; background: #eef2f5; border-radius: 6px; display: none; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🚴‍♂️ Radiociclismo AI</h1>
        <label>URL ProCyclingStats</label>
        <input type="text" id="url" placeholder="https://www.procyclingstats.com/race/...">
        <label>Nome Gara</label>
        <input type="text" id="name" placeholder="Es. Amstel Gold Race">
        <button onclick="run()">Lancia Agente</button>
        <div id="status"></div>
      </div>
      <script>
        async function run() {
          const status = document.getElementById('status');
          const url = document.getElementById('url').value;
          const name = document.getElementById('name').value;
          if(!url) return alert('Inserisci un URL');
          
          status.style.display = 'block';
          status.innerText = '🚀 Agente in sella... analizzo i dati.';
          
          try {
            const res = await fetch('/api/workflows/cycling-sync/execute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ input: { raceUrl: url, raceName: name || 'Gara Ciclismo' } })
            });
            const data = await res.json();
            status.innerText = '🏁 Traguardo raggiunto! Articolo generato.';
          } catch (e) {
            status.innerText = '⚠️ Errore durante la generazione.';
          }
        }
      </script>
    </body>
    </html>
  `);
}
