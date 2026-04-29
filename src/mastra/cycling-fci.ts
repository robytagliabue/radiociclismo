import { inngest, FCI_EVENT } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";

function fetchPage(url: string): string {
  try {
    const cmd = `curl -s -L --http2 --max-time 30 -H "User-Agent: Mozilla/5.0" --compressed "${url}"`;
    return execSync(cmd, { maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (e) { return ""; }
}

export const fciWorkflowFn = inngest.createFunction(
  { id: "fci-workflow", name: "RadioCiclismo — Nazionali & News", concurrency: 2 },
  { event: FCI_EVENT },
  async ({ step }) => {
    // 1. Scraping News Giovani
    const newsArticoli = await step.run("scrape-news", async () => {
      const html = fetchPage("https://bici.pro/news/giovani/");
      const $ = cheerio.load(html);
      const items: any[] = [];
      $("article").each((i, el) => {
        const titolo = $(el).find("h2").text().trim();
        const url = $(el).find("a").attr("href");
        if (titolo && url && i < 2) items.push({ titolo, url });
      });
      return items;
    });

    // 2. Elaborazione e pubblicazione per ogni news
    for (const art of newsArticoli) {
      await step.run(`process-fci-${art.titolo.substring(0,5)}`, async () => {
        const htmlArt = fetchPage(art.url);
        const $art = cheerio.load(htmlArt);
        const corpo = $art("article").text().substring(0, 2500);

        // Recupero Ranking per dare contesto all'AI
        let ranking = "Nessun dato ranking.";
        try {
          const r = await axios.get(`${RC_BASE}/api/athletes-ranking?category=under23&limit=3`);
          ranking = JSON.stringify(r.data);
        } catch {}

        const res = await (cyclingAgent as any).generateLegacy(
          `Rielabora per RadioCiclismo: ${art.titolo}. Testo: ${corpo}. 
          Contesto Ranking: ${ranking}. 
          RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "", "slug": "", "tags": [] }`
        );

        const articolo = res?.object || res;
        
        // Pubblicazione (Richiede cookie come in PCS, qui omesso per brevità ma integrabile)
        console.log("Articolo FCI Pronto per il DB:", articolo.titolo);
      });
    }
    return { processed: newsArticoli.length };
  }
);
