import { inngest, FCI_EVENT } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";

function fetchPage(url: string): string {
  try {
    const cmd = `curl -s -L --http2 --max-time 30 -H "User-Agent: Mozilla/5.0" --compressed "${url}"`;
    return execSync(cmd, { maxBuffer: 15 * 1024 * 1024 }).toString();
  } catch (e) { return ""; }
}

async function getSessionCookie(): Promise<string> {
  try {
    const res = await axios.post(`${RC_BASE}/api/admin/login`, 
      { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD },
      { headers: { "Content-Type": "application/json" } }
    );
    return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
  } catch { return ""; }
}

export const fciWorkflowFn = inngest.createFunction(
  { id: "fci-workflow", name: "RadioCiclismo — Nazionali & News", concurrency: 2 },
  { event: FCI_EVENT },
  async ({ step }) => {
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

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

    for (const art of newsArticoli) {
      await step.run(`process-fci-${art.titolo.substring(0,5)}`, async () => {
        const htmlArt = fetchPage(art.url);
        const corpo = cheerio.load(htmlArt)("article").text().substring(0, 2500);

        let ranking = "Dati ranking non disponibili.";
        try {
          const r = await axios.get(`${RC_BASE}/api/athletes-ranking?category=under23&limit=5`);
          ranking = JSON.stringify(r.data);
        } catch {}

        const res = await (cyclingAgent as any).generateLegacy(
          `Rielabora per RadioCiclismo: ${art.titolo}. Testo: ${corpo}. Contest Ranking: ${ranking}. RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "", "tags": [] }`
        );

        const articolo = res?.object || res;
        
        if (articolo && sessionCookie) {
          const payload = {
            slug: art.titolo.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, ''),
            title: articolo.titolo,
            titleEn: null,
            excerpt: articolo.excerpt,
            excerptEn: null,
            content: articolo.contenuto,
            contentEn: null,
            coverImageUrl: null,
            images: [],
            hashtags: articolo.tags || [],
            author: "RadioCiclismo AI",
            publishAt: new Date().toISOString()
          };

          await axios.post(`${RC_BASE}/api/admin/articles`, payload, {
            headers: { Cookie: sessionCookie }
          });
        }
      });
    }
    return { processed: newsArticoli.length };
  }
);
