import { inngest, FCI_EVENT } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";
const BIPRO_URL = "https://bici.pro/news/giovani/";

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

export const fciWorkflowFn = inngest.createFunction(
  { id: "fci-workflow", name: "RadioCiclismo — Nazionali & News", concurrency: 2 },
  { event: FCI_EVENT },
  async ({ step }) => {
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

    const newsArticoli = await step.run("scrape-bicipro", async () => {
      const html = fetchPage(BIPRO_URL);
      const $ = cheerio.load(html);
      const news: any[] = [];
      $("article").each((i, el) => {
        const titolo = $(el).find("h2").text().trim();
        const url = $(el).find("a").attr("href");
        if (titolo && url && i < 3) news.push({ titolo, url });
      });
      return news;
    });

    for (const art of newsArticoli) {
      await step.run(`process-news-${art.titolo.substring(0,10)}`, async () => {
        const htmlArt = fetchPage(art.url);
        const $art = cheerio.load(htmlArt);
        const corpoTesto = $art("article, .entry-content").text().substring(0, 3000);

        // Usiamo .generate() passandogli direttamente la stringa
        const res = await cyclingAgent.generate(
          `Sei l'esperto di RadioCiclismo. Rielabora questa notizia: ${art.titolo}. 
          Testo: ${corpoTesto}. 
          Rispondi in JSON con: titolo, contenuto, excerpt, slug, tags.`
        );

        const articolo = (res as any).object || res;

        await axios.post(`${RC_BASE}/api/admin/articles`, {
          slug: articolo.slug || art.titolo.replace(/ /g, "-"),
          title: articolo.titolo,
          content: articolo.contenuto,
          excerpt: articolo.excerpt || "",
          author: "Redazione Giovani AI",
          published: false,
          hashtags: articolo.tags || ["ciclismo"]
        }, { headers: { Cookie: sessionCookie } });
      });
    }

    return { processed: newsArticoli.length };
  }
);
