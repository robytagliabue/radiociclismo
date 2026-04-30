import { inngest, FCI_EVENT } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";

// Helper per lo slug (URL safe)
const slugify = (text: string) => 
  text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');

function fetchPage(url: string): string {
  try {
    const cmd = `curl -s -L --http2 --max-time 30 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --compressed "${url}"`;
    return execSync(cmd, { maxBuffer: 15 * 1024 * 1024 }).toString();
  } catch (e) { 
    console.error(`Errore nel fetch di ${url}:`, e);
    return ""; 
  }
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
  { id: "fci-workflow", name: "RadioCiclismo — Nazionali e Giovanili", concurrency: 2 },
  { event: FCI_EVENT },
  async ({ step }) => {
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

    const newsArticoli = await step.run("scrape-all-sources", async () => {
      const items: any[] = [];
      const sources = [
        { name: "BiciPro", url: "https://bici.pro/news/giovani/" },
        { name: "FCI Strada", url: "https://www.federciclismo.it/it/article-archive/98717172-e565-4965-b6ca-b830d6961633/" },
        { name: "FCI Giovanile", url: "https://www.federciclismo.it/it/article-archive/25263677-7443-4161-9f93-4700d83296c0/" }
      ];

      for (const src of sources) {
        const html = fetchPage(src.url);
        if (!html) continue;
        const $ = cheerio.load(html);
        const container = src.name.includes("FCI") ? ".article-list .item, .news-list a" : "article";

        $(container).each((i, el) => {
          if (i < 2) {
            const titolo = $(el).find("h2").text().trim() || $(el).text().trim();
            let link = $(el).find("a").attr("href") || $(el).attr("href");
            if (link && titolo.length > 10) {
              items.push({ titolo, url: link.startsWith("http") ? link : `https://www.federciclismo.it${link}`, fonte: src.name });
            }
          }
        });
      }
      return items;
    });

    for (const art of newsArticoli) {
      await step.run(`process-${art.titolo.substring(0,10)}`, async () => {
        const htmlArt = fetchPage(art.url);
        const corpo = cheerio.load(htmlArt)("article, .article-content").text().substring(0, 2500);

        // Chiamata all'agente con istruzioni anti-test
        const res = await (cyclingAgent as any).generateLegacy(
          `Sei un giornalista sportivo. Rielabora questa notizia da ${art.fonte}: ${art.titolo}. 
          Testo: ${corpo}. 
          IMPORTANTE: Non generare testi brevi o di prova. Scrivi un articolo completo. 
          RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "", "tags": [] }`
        );

        const articoloAI = res?.object || res;
        
        // Verifica che l'articolo non sia vuoto o "test"
        if (articoloAI && articoloAI.contenuto && articoloAI.contenuto.length > 100 && sessionCookie) {
          
          // CALCOLO RITARDO: Ora attuale + 2 ore
          const scheduledTime = new Date();
          scheduledTime.setHours(scheduledTime.getHours() + 2);

          const payload = {
            slug: `news-${Date.now()}-${slugify(art.titolo)}`,
            title: articoloAI.titolo || art.titolo,
            titleEn: "",
            excerpt: articoloAI.excerpt || "",
            excerptEn: "",
            content: articoloAI.contenuto,
            contentEn: "",
            coverImageUrl: "",
            images: [],
            hashtags: [...(articoloAI.tags || []), "#giovanili", "#ciclismo"],
            author: "RadioCiclismo AI",
            publishAt: scheduledTime.toISOString() // Programmato tra 2 ore
          };

          try {
            await axios.post(`${RC_BASE}/api/admin/articles`, payload, {
              headers: { 
                Cookie: sessionCookie, 
                "Content-Type": "application/json" 
              }
            });
          } catch (err: any) {
            console.error("ERRORE INVIO FCI:", err.response?.data);
          }
        } else {
          console.warn(`Articolo per "${art.titolo}" scartato perché vuoto o non valido.`);
        }
      });
    }
    return { processed: newsArticoli.length };
  }
);
