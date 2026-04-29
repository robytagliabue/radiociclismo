import { inngest } from "./inngest.js";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

// Configurazione basi
const RC_BASE = "https://radiociclismo.com";
const BIPRO_URL = "https://bici.pro/news/giovani/";
const FCI_STRADA_URL = "https://www.federciclismo.it/it/section/strada/00965045-812e-4b68-9a99-9689945a05b1/";

// Categorie target
const CATEGORIE_ARTICOLO = ["allievi", "juniores", "under23", "elite"];

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
    const cmd = `curl -s -L --http2 --max-time 30 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36" --compressed "${url}"`;
    return execSync(cmd, { maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (e: any) { return `ERRORE: ${e.message}`; }
}

function mapCategoriaToRCRanking(cat: string): string {
  const c = cat.toLowerCase();
  if (c.includes("allievi")) return c.includes("donne") ? "donne_allieve" : "allievi";
  if (c.includes("juniores")) return c.includes("donne") ? "donne_juniores" : "juniores";
  return c.includes("donne") ? "donne_under23_elite" : "under23_elite";
}

// --- LOGICA DI WORKFLOW ---

export const fciWorkflowFn = inngest.createFunction(
  { id: "fci-workflow", name: "RadioCiclismo — Nazionali & News", concurrency: 2 },
  { event: "cycling/generate.fci.article" },
  async ({ step }) => {
    const report: string[] = [];
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

    // 1. PIPELINE RISULTATI DAL DATABASE (Gare FCI Nazionali)
    const gareOggi = await step.run("fetch-db-races", async () => {
      const oggi = new Date().toISOString().split("T")[0];
      // Nota: Qui devi assicurarti che il tuo db sia accessibile dal worker
      // const res = await db.query("SELECT ... WHERE DATE(start_date) = $1", [oggi]);
      // return res.rows;
      return []; // Placeholder: sostituisci con la tua query reale
    });

    // 2. PIPELINE NEWS (Scraping Bici.pro e FCI)
    const newsArticoli = await step.run("scrape-news-sites", async () => {
      const news: any[] = [];
      const oggi = new Date().toLocaleDateString('it-IT'); // Formato tipico siti IT

      // Scraping Bici.pro
      const htmlBP = fetchPage(BIPRO_URL);
      const $bp = cheerio.load(htmlBP);
      $bp("article").each((_, el) => {
          const titolo = $bp(el).find("h2").text().trim();
          const url = $bp(el).find("a").attr("href");
          if (titolo && url) news.push({ titolo, url, fonte: "Bici.pro" });
      });

      return news.slice(0, 5); // Limitiamo per il piano free
    });

    // 3. GENERAZIONE ARTICOLI PER NEWS TROVATE
    for (const art of newsArticoli) {
      await step.run(`process-news-${art.titolo.substring(0,10)}`, async () => {
        // Check duplicati
        const check = await axios.get(`${RC_BASE}/api/admin/articles?search=${encodeURIComponent(art.titolo.substring(0,15))}`, { headers: { Cookie: sessionCookie } });
        if (check.data?.length > 0) return;

        // Estrazione testo completo notizia
        const htmlArt = fetchPage(art.url);
        const $art = cheerio.load(htmlArt);
        const corpoTesto = $("article, .entry-content").text().substring(0, 3000);

        // Generazione con AI arricchita da RadioCiclismo Ranking
        const categoria = art.titolo.toLowerCase().includes("juniores") ? "juniores" : "under23";
        const catRC = mapCategoriaToRCRanking(categoria);

        // Recupero Ranking RC per contesto
        let rankingContesto = "";
        try {
          const rankRes = await axios.get(`${RC_BASE}/api/athletes-ranking?category=${catRC}&limit=10`);
          rankingContesto = rankRes.data.map((a: any, i: number) => `${i+1}. ${a.name}`).join(", ");
        } catch (e) {}

        const result = await generateObject({
          model: google("gemini-1.5-flash"),
          prompt: `Sei l'esperto di ciclismo giovanile di RadioCiclismo. Rielabora questa notizia: ${art.titolo}. 
          Testo originale: ${corpoTesto}. 
          Contesto Ranking RadioCiclismo attuale (${categoria}): ${rankingContesto}.
          Se qualcuno dei nomi nel testo è nel ranking, evidenzialo. 
          Link obbligatorio: https://radiociclismo.com/giovani.
          Stile: Diretto, tecnico, focalizzato sul futuro del ciclismo italiano.`,
          schema: z.object({
            titolo: z.string(),
            contenuto: z.string(),
            slug: z.string(),
            tags: z.array(z.string())
          })
        });

        // Pubblicazione
        await axios.post(`${RC_BASE}/api/admin/articles`, {
          ...result.object,
          author: "Redazione Giovani AI",
          published: false
        }, { headers: { Cookie: sessionCookie } });
      });
    }

    return { processed: newsArticoli.length };
  }
);
