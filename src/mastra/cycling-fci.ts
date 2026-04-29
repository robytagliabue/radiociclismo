import { inngest, FCI_EVENT } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";

/**
 * Funzione helper per scaricare il contenuto HTML usando curl
 * (Più robusta contro i blocchi rispetto ad axios standard)
 */
function fetchPage(url: string): string {
  try {
    const cmd = `curl -s -L --http2 --max-time 30 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --compressed "${url}"`;
    return execSync(cmd, { maxBuffer: 15 * 1024 * 1024 }).toString();
  } catch (e) {
    console.error(`Errore durante il fetching di ${url}:`, e);
    return "";
  }
}

/**
 * Recupera il cookie di sessione per l'area admin
 */
async function getSessionCookie(): Promise<string> {
  try {
    const res = await axios.post(`${RC_BASE}/api/admin/login`, 
      { 
        username: process.env.RC_USERNAME, 
        password: process.env.RC_PASSWORD 
      },
      { headers: { "Content-Type": "application/json" } }
    );
    const cookies = res.headers["set-cookie"] || [];
    return cookies.find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
  } catch (error) {
    console.error("Errore login RadioCiclismo:", error);
    return "";
  }
}

export const fciWorkflowFn = inngest.createFunction(
  { id: "fci-workflow", name: "RadioCiclismo — Nazionali & News", concurrency: 2 },
  { event: FCI_EVENT },
  async ({ step }) => {
    
    // 1. LOGIN
    const sessionCookie = await step.run("auth-admin", async () => {
      return await getSessionCookie();
    });

    // 2. SCRAPING LISTA NEWS (Bici.pro - sezione giovani)
    const newsArticoli = await step.run("scrape-list-news", async () => {
      const html = fetchPage("https://bici.pro/news/giovani/");
      const $ = cheerio.load(html);
      const items: { titolo: string; url: string }[] = [];
      
      $("article").each((i, el) => {
        const titolo = $(el).find("h2").text().trim();
        const url = $(el).find("a").attr("href");
        if (titolo && url && i < 3) { // Limitiamo alle ultime 3 news
          items.push({ titolo, url });
        }
      });
      return items;
    });

    // 3. ELABORAZIONE SINGOLI ARTICOLI
    for (const art of newsArticoli) {
      const newsId = art.titolo.substring(0, 10).replace(/\s/g, '-');

      await step.run(`process-fci-news-${newsId}`, async () => {
        // Scarica il corpo dell'articolo
        const htmlArt = fetchPage(art.url);
        const $art = cheerio.load(htmlArt);
        const corpoSorgente = $art("article").text().substring(0, 3000);

        // Recupera i ranking attuali Under 23 per dare contesto all'AI
        let rankingContext = "Dati ranking non disponibili.";
        try {
          const r = await axios.get(`${RC_BASE}/api/athletes-ranking?category=under23&limit=5`);
          rankingContext = JSON.stringify(r.data);
        } catch (e) { /* ignore */ }

        // Generazione con Claude via Mastra
        // Usiamo la stringa diretta per evitare errori di validazione del ruolo
        const prompt = `Sei un giornalista di RadioCiclismo. 
          Rielabora questa notizia: \${art.titolo}. 
          Testo originale: \${corpoSorgente}. 
          Contesto Ranking RadioCiclismo: \${rankingContext}.
          Scrivi un articolo professionale, tecnico e aggiungi un commento basato sui ranking se pertinente.
          RITORNA SOLO JSON: { "titolo": "", "contenuto": "", "excerpt": "", "slug": "", "tags": [] }`;

        const res = await (cyclingAgent as any).generateLegacy(prompt);
        const articolo = res?.object || res;

        if (articolo && sessionCookie) {
          // 4. PUBBLICAZIONE SUL DB
          await axios.post(`${RC_BASE}/api/admin/articles`, {
            title: articolo.titolo,
            content: articolo.contenuto,
            excerpt: articolo.excerpt,
            slug: articolo.slug || art.titolo.toLowerCase().replace(/\s+/g, '-'),
            author: "RadioCiclismo AI",
            category: "giovani",
            published: false, // Lo salviamo come bozza
            hashtags: articolo.tags
          }, { 
            headers: { "Cookie": sessionCookie } 
          });
          
          console.log(`✅ Articolo pubblicato con successo: \${articolo.titolo}`);
        }
      });
    }

    return { processedCount: newsArticoli.length };
  }
);
