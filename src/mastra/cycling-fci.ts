import { inngest, FCI_EVENT } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";
const slugify = (t: string) => t.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');

export const fciWorkflowFn = inngest.createFunction(
  { id: "fci-workflow", name: "RadioCiclismo — News Nazionali", concurrency: 1 },
  { event: FCI_EVENT },
  async ({ step }) => {
    
    const sessionCookie = await step.run("get-cookie", async () => {
        const res = await axios.post(`${RC_BASE}/api/admin/login`, 
            { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD }
        );
        return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
    });

    const newsItems = await step.run("scrape-sources", async () => {
      const sources = [
        { name: "FCI Strada", url: "https://www.federciclismo.it/it/article-archive/98717172-e565-4965-b6ca-b830d6961633/" },
        { name: "BiciPro", url: "https://bici.pro/news/giovani/" }
      ];
      let results: any[] = [];
      for (const src of sources) {
        const html = execSync(`curl -s -L -H "User-Agent: Mozilla/5.0" "${src.url}"`).toString();
        const $ = cheerio.load(html);
        $("article, .post-item, .item").slice(0, 3).each((_, el) => {
           const title = $(el).find("h2, h3, .title").text().trim();
           let link = $(el).find("a").attr("href");
           if (title && link) {
             results.push({ title, url: link.startsWith("http") ? link : new URL(src.url).origin + link });
           }
        });
      }
      return results;
    });

    for (const item of newsItems) {
      await step.run(`process-news-${slugify(item.title.substring(0, 20))}`, async () => {
        const fullHtml = execSync(`curl -s -L -H "User-Agent: Mozilla/5.0" "${item.url}"`).toString();
        const articleText = cheerio.load(fullHtml)("article, .content").text().trim();

        if (articleText.length < 300) return;

        const res = await (cyclingAgent as any).generateLegacy(
          `Rielabora in stile FLASH NEWS: ${item.title}. Testo: ${articleText.substring(0, 1500)}. JSON {titolo, contenuto, excerpt, tags}.`
        );
        const ai = res?.object || res;

        if (ai && ai.contenuto) {
          const date = new Date();
          date.setHours(date.getHours() + 1);

          try {
            await axios.post(`${RC_BASE}/api/admin/articles`, {
              title: ai.titolo,
              content: ai.contenuto,
              excerpt: ai.excerpt,
              slug: `news-${slugify(ai.titolo)}-${Date.now()}`,
              author: "Radiociclismo Reporter",
              publishAt: date.toISOString(),
              hashtags: ai.tags || ["#fci"],
              is_published: false
            }, { headers: { Cookie: sessionCookie, "Content-Type": "application/json" } });
          } catch (err: any) {
            console.error("ERRORE 400 FCI:", err.response?.data);
          }
        }
      });
    }
  }
);
