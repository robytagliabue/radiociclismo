import { inngest, FCI_EVENT } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";

const slugify = (text: string) => 
  text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
const STILI_EDITORIALI = [
  {
    id: "EPICO_NARRATORE",
    prompt: "Stile L'EPICO NARRATORE — Focus: resilienza e percorso dell'atleta. Usa dati reali. Se mancano dati storici, passa allo stile CRONISTA FLASH."
  },
  {
    id: "SPECIALISTA_TECNICO",
    prompt: "Stile LO SPECIALISTA TECNICO — Focus: tattica e momenti chiave (scatti, ventagli, salite). Zero aggettivi vuoti."
  },
  {
    id: "FLASH_NEWS",
    prompt: "Stile IL CRONISTA FLASH — Focus: fatti nudi e crudi. Perfetto per lettura rapida."
  },
  {
    id: "TECH_GURU",
    prompt: "Stile IL TECH-GURU — Focus: materiali e performance. Se mancano dati sui watt, passa a SPECIALISTA TECNICO."
  }
];
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
            const link = $(el).find("a").attr("href") || $(el).attr("href");
            if (link && titolo.length > 15) {
              items.push({ 
                titolo, 
                url: link.startsWith("http") ? link : `https://www.federciclismo.it${link}`, 
                fonte: src.name 
              });
            }
          }
        });
      }
      return items;
    });

    for (const art of newsArticoli) {
      await step.run(`process-${art.titolo.substring(0,10)}`, async () => {
        const htmlArt = fetchPage(art.url);
        const corpo = cheerio.load(htmlArt)("article, .article-content").text().trim();

        // Salto immediato se il testo sorgente è povero
        if (corpo.length < 300) return { skipped: "Source too short" };

        const res = await (cyclingAgent as any).generateLegacy(
          `Crea un articolo per RadioCiclismo da: ${art.titolo}. Testo: ${corpo}.
          Se non puoi costruire un pezzo giornalistico valido, scrivi "SKIP".
          RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "", "tags": [] }`
        );

        const articoloAI = res?.object || res;
        
        if (articoloAI && articoloAI !== "SKIP" && articoloAI.contenuto?.length > 250 && sessionCookie) {
          const scheduledDate = new Date();
          scheduledDate.setHours(scheduledDate.getHours() + 2);

          const payload = {
            slug: slugify(art.titolo),
            title: articoloAI.titolo,
            content: articoloAI.contenuto,
            excerpt: articoloAI.excerpt,
            author: "RadioCiclismo AI",
            publishAt: scheduledDate.toISOString(),
            hashtags: [...(articoloAI.tags || []), "#giovanili"],
            titleEn: "", excerptEn: "", contentEn: "", coverImageUrl: "", images: []
          };

          try {
            await axios.post(`${RC_BASE}/api/admin/articles`, payload, {
              headers: { Cookie: sessionCookie, "Content-Type": "application/json" }
            });
          } catch (err) {
            console.log("Salto: possibile duplicato.");
          }
        }
      });
    }
    return { processed: newsArticoli.length };
  }
);
