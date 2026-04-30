import { inngest, FCI_EVENT } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";

const slugify = (t: string) => t.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');

// Esportiamo esattamente il nome cercato da inngest.ts
export const fciWorkflowFn = inngest.createFunction(
  { id: "fci-workflow", name: "RadioCiclismo — News Nazionali", concurrency: 1 },
  { event: FCI_EVENT },
  async ({ step }) => {
    
    // 1. Recupero Cookie di sessione per l'invio articoli
    const sessionCookie = await step.run("get-cookie", async () => {
      try {
        const res = await axios.post(`${RC_BASE}/api/admin/login`, 
          { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD },
          { headers: { "Content-Type": "application/json" } }
        );
        return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
      } catch (err) {
        console.error("Errore login RC:", err);
        return "";
      }
    });

    // 2. Scraping delle sorgenti nazionali (FCI e BiciPro Giovani)
    const newsItems = await step.run("scrape-sources", async () => {
      const sources = [
        { name: "FCI Strada", url: "https://www.federciclismo.it/it/article-archive/98717172-e565-4965-b6ca-b830d6961633/" },
        { name: "BiciPro Giovani", url: "https://bici.pro/news/giovani/" }
      ];
      
      let results: any[] = [];
      for (const src of sources) {
        try {
          const html = execSync(`curl -s -L -H "User-Agent: Mozilla/5.0" "${src.url}"`).toString();
          const $ = cheerio.load(html);
          
          // Logica specifica per estrarre titoli e link (adattata ai portali)
          $("article, .post-item, .item").slice(0, 3).each((_, el) => {
             const title = $(el).find("h2, h3, .title").text().trim();
             let link = $(el).find("a").attr("href");
             
             if (title && link) {
               if (!link.startsWith("http")) {
                 const baseUrl = new URL(src.url).origin;
                 link = baseUrl + link;
               }
               results.push({ title, url: link });
             }
          });
        } catch (e) {
          console.error(`Errore scraping ${src.name}:`, e);
        }
      }
      return results;
    });

    // 3. Elaborazione di ogni news trovata
    for (const item of newsItems) {
      await step.run(`process-news-${slugify(item.title.substring(0, 20))}`, async () => {
        // Scarichiamo il contenuto completo della news
        const fullHtml = execSync(`curl -s -L -H "User-Agent: Mozilla/5.0" "${item.url}"`).toString();
        const $ = cheerio.load(fullHtml);
        const articleText = $("article, .entry-content, .content").text().trim();

        if (articleText.length < 300) return { status: "content_too_short" };

        // Chiediamo all'AI di rielaborare in stile RadioCiclismo
        const prompt = `
          Sei un giornalista di RadioCiclismo esperto di ciclismo giovanile e nazionale.
          Rielabora questa notizia in stile FLASH NEWS (diretto, informativo, professionale).
          
          Titolo originale: ${item.title}
          Testo: ${articleText.substring(0, 2000)}
          
          Ritorna rigorosamente un JSON:
          {
            "titolo": "Titolo accattivante",
            "contenuto": "Testo dell'articolo in HTML (usa <p>, <strong>)",
            "excerpt": "Breve riassunto di due righe",
            "tags": ["#giovanili", "#fci", "#ciclismo"]
          }
        `;

        const aiRes = await (cyclingAgent as any).generateLegacy(prompt);
        const ai = aiRes?.object || aiRes;

        if (ai && ai.contenuto && ai.contenuto.length > 200) {
          // 4. Invio al Database come bozza programmata (+1 ora)
          const publishDate = new Date();
          publishDate.setHours(publishDate.getHours() + 1);

          await axios.post(`${RC_BASE}/api/admin/articles`, {
            slug: `fci-${slugify(ai.titolo)}-${Date.now()}`,
            title: ai.titolo,
            content: ai.contenuto,
            excerpt: ai.excerpt,
            author: "RadioCiclismo Reporter",
            publishAt: publishDate.toISOString(),
            hashtags: ai.tags,
            is_published: false // Resta in bozza per revisione
          }, { 
            headers: { Cookie: sessionCookie } 
          });

          return { status: "success", title: ai.titolo };
        }
        
        return { status: "ai_generation_failed" };
      });
    }
    
    return { processed: newsItems.length };
  }
);
