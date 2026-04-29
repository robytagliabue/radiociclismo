import { inngest, FCI_EVENT } from "./client.js";
import { cyclingAgent } from "./cyclingAgent.js"; // Importiamo l'Agente Mastra
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

// Configurazione basi
const RC_BASE = "https://radiociclismo.com";
const BIPRO_URL = "https://bici.pro/news/giovani/";

// --- UTILS ---

async function getSessionCookie(): Promise<string> {
  try {
    const res = await axios.post(`${RC_BASE}/api/admin/login`, 
      { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD },
      { headers: { "Content-Type": "application/json" } }
    );
    return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
  } catch { return ""; }
}

function fetchPage(url: string): string {
  try {
    const cmd = `curl -s -L --http2 --max-time 30 -H "User-Agent: Mozilla/5.0" --compressed "${url}"`;
    return execSync(cmd, { maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (e: any) { return ""; }
}

// --- WORKFLOW NAZIONALE ---

export const fciWorkflowFn = inngest.createFunction(
  { id: "fci-workflow", name: "RadioCiclismo — Nazionali & News", concurrency: 2 },
  { event: FCI_EVENT },
  async ({ step }) => {
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

    // 1. SCRAPING NEWS (Bici.pro / Giovani)
    const newsArticoli = await step.run("scrape-bicipro", async () => {
      const html = fetchPage(BIPRO_URL);
      const $ = cheerio.load(html);
      const news: any[] = [];

      $("article").each((i, el) => {
        const titolo = $(el).find("h2").text().trim();
        const url = $(el).find("a").attr("href");
        if (titolo && url && i < 3) {
          news.push({ titolo, url, fonte: "Bici.pro" });
        }
      });
      return news;
    });

    // 2. ELABORAZIONE NEWS CON AGENTE MASTRA
    for (const art of newsArticoli) {
      await step.run(`process-news-${art.titolo.substring(0,10)}`, async () => {
        
        // Controllo duplicati rapido
        const check = await axios.get(`${RC_BASE}/api/admin/articles?search=${encodeURIComponent(art.titolo.substring(0,15))}`, 
          { headers: { Cookie: sessionCookie } }
        );
        if (check.data?.articles?.length > 0 || check.data?.length > 0) return;

        // Estrazione testo completo notizia per l'agente
        const htmlArt = fetchPage(art.url);
        const $art = cheerio.load(htmlArt);
        const corpoTesto = $art("article, .entry-content").text().substring(0, 3000);

        // Recupero Ranking RadioCiclismo per arricchire il prompt
        const categoria = art.titolo.toLowerCase().includes("juniores") ? "juniores" : "under23";
        let rankingInfo = "Nessun dato ranking disponibile.";
        try {
          const rankRes = await axios.get(`${RC_BASE}/api/athletes-ranking?category=${categoria}&limit=5`);
          rankingInfo = JSON.stringify(rankRes.data);
        } catch (e) {}

        // CHIAMATA ALL'AGENTE MASTRA
        const result = await cyclingAgent.generate({
          prompt: `Sei l'esperto del vivaio di RadioCiclismo. Rielabora questa notizia italiana: ${art.titolo}.
          Testo originale: ${corpoTesto}.
          Contesto Ranking attuale (${categoria}): ${rankingInfo}.
          Usa i tuoi strumenti per verificare se abbiamo già parlato di questi atleti.
          Obiettivo: Scrivi un articolo tecnico e incoraggiante per il ciclismo italiano.`,
        });

        const articolo = result.object;

        // 3. PUBBLICAZIONE (Bozza)
        await axios.post(`${RC_BASE}/api/admin/articles`, {
          slug: articolo.slug || art.titolo.toLowerCase().replace(/ /g, "-"),
          title: articolo.titolo,
          content: articolo.contenuto,
          excerpt: articolo.excerpt || "",
          author: "Redazione Giovani AI",
          published: false,
          hashtags: articolo.tags || ["ciclismo", "giovani", "italia"]
        }, { headers: { Cookie: sessionCookie } });
      });
    }

    return { processed: newsArticoli.length };
  }
);
