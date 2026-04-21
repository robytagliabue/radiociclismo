import { Mastra, createNodeMiddleware } from '@mastra/core';
import { cyclingAgent } from './cyclingAgent.js';
import { cyclingWorkflow } from './cyclingWorkflow.js';

// Inizializzazione Mastra
export const mastra = new Mastra({
  agents: { cyclingAgent },
  workflows: { cyclingWorkflow },
});

/**
 * Handler principale per Vercel
 */
export default async function handler(req: any, res: any) {
  const url = req.url || '';

  try {
    // 1. Gestione rotte API per i workflow
    if (url.includes('/api/')) {
      const middleware = createNodeMiddleware(mastra);
      return await middleware(req, res);
    }

    // 2. Interfaccia Dashboard
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="UTF-8">
        <title>Radiociclismo Control Panel</title>
        <style>
          body { font-family: -apple-system, sans-serif; max-width: 500px; margin: 40px auto; padding: 20px; background: #f0f2f5; }
          .card { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
          h1 { color: #1a1a1a; font-size: 24px; margin-bottom: 20px; text-align: center; }
          label { display: block; margin-bottom: 5px; font-weight: bold; color: #444; }
          input { width: 100%; padding: 12px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; }
          button { width: 100%; padding: 15px; background: #0070f3; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
          button:hover { background: #0051bb; }
          #log { margin-top: 20px; padding: 10px; border-radius: 5px; font-size: 14px; display: none; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🚴‍♂️ Radiociclismo AI</h1>
          <label>URL ProCyclingStats</label>
          <input type="text" id="url" placeholder="https://www.procyclingstats.com/race/..." />
          
          <label>Nome Gara</label>
          <input type="text" id="name" placeholder="Esempio: Amstel Gold Race" />
          
          <button id="runBtn" onclick="runAgent()">Genera Articolo</button>
          <div id="log"></div>
        </div>

        <script>
          async function runAgent() {
            const btn = document.getElementById('runBtn');
            const log = document.getElementById('log');
            const url = document.getElementById('url').value;
            const name = document.getElementById('name').value;

            if(!url) return alert('Inserisci un URL!');

            btn.disabled = true;
            btn.innerText = 'Agente in azione...';
            log.style.display = 'block';
            log.style.background = '#e7f3ff';
            log.innerText = 'Analisi in corso. Controllo duplicati e generazione articolo...';

            try {
              const res = await fetch('/api/workflows/cycling-sync/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: { raceUrl: url, raceName: name || 'Gara Ciclismo' } })
              });
              const data = await res.json();
              log.style.background = '#e6ffed';
              log.innerText = 'Fatto! Articolo pubblicato. ID: ' + (data.runId || 'OK');
            } catch (e) {
              log.style.background = '#fff0f0';
              log.innerText = 'Errore durante la generazione.';
            } finally {
              btn.disabled = false;
              btn.innerText = 'Genera Articolo';
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
