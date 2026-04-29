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
    // 1. SCRAPING
    const newsArticoli = await step.run("scrape-news", async () => {
      const html = fetchPage("https://bici.pro/news/giovani/");
      const $ = cheerio.load(html);
      const news: any[] = [];
      $("article").each((i, el) => {
        const titolo = $(el).find("h2").text().trim();
        const url = $(el).find("a").attr("href");
        if (titolo && url && i < 2) news.push({ titolo, url });
      });
      return news;
    });

    // 2. ELABORAZIONE AI
    for (const art of newsArticoli) {
      await step.run(`process-fci-${art.titolo.substring(0,5)}`, async () => {
        const htmlArt = fetchPage(art.url);
        const $art = cheerio.load(htmlArt);
        const corpoTesto = $art("article").text().substring(0, 2000);

        const res = await cyclingAgent.generateLegacy({
          messages: [
            {
              role: "user",
              content: `Rielabora per RadioCiclismo: ${art.titolo}. Testo: ${corpoTesto}. 
              RITORNA SOLO JSON: { "titolo": "", "contenuto": "", "excerpt": "", "slug": "", "tags": [] }`
            }
          ]
        });

        const articolo = (res as any).object || res;
        console.log("Generato FCI:", articolo.titolo);
      });
    }

    return { processed: newsArticoli.length };
  }
);
