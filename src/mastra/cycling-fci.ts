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
    // Login
    const sessionCookie = await step.run("get-cookie", async () => {
       const res = await axios.post(`${RC_BASE}/api/admin/login`, 
        { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD });
       return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
    });

    // Scraper
    const newsItems = await step.run("scrape-sources", async () => {
      const sources = [
        { name: "FCI Strada", url: "https://www.federciclismo.it/it/article-archive/98717172-e565-4965-b6ca-b830d6961633/" },
        { name: "BiciPro", url: "https://bici.pro/news/giovani/" }
      ];
      let results: any[] = [];
      for (const src of sources) {
        const html = execSync(`curl -s -L -H "User-Agent: Mozilla/5.0" "${src.url}"`).toString();
        const $ = cheerio.load(html);
        $("article, .item").slice(0, 3).each((i, el) => {
           const title = $(el).find("h2, .title").text().trim();
           const link = $(el).find("a").attr("href");
           if (title && link) results.push({ title, url: link.startsWith("http") ? link : `https://www.federciclismo.it${link}` });
        });
      }
      return results;
    });

    // Processamento
    for (const item of newsItems) {
      await step.run(`process-news-${slugify(item.title.substring(0, 15))}`, async () => {
        const html = execSync(`curl -s -L -H "User-Agent: Mozilla/5.0" "${item.url}"`).toString();
        const content = cheerio.load(html)("article, .content").text().trim();

        if (content.length < 400) return { status: "too_short" };

        const res = await (cyclingAgent as any).generateLegacy(
          `Crea un articolo giornalistico da questa news: ${item.title}. Contenuto: ${content}. 
          Usa lo stile CRONISTA FLASH. Se non è rilevante, scrivi "SKIP".
          Ritorna JSON: { "titolo": "", "contenuto": "", "excerpt": "" }`
        );

        const ai = res?.object || res;
        if (ai && ai !== "SKIP" && ai.contenuto?.length > 250) {
          const publishDate = new Date();
          publishDate.setHours(publishDate.getHours() + 1);

          await axios.post(`${RC_BASE}/api/admin/articles`, {
            slug: slugify(ai.titolo),
            title: ai.titolo,
            content: ai.contenuto,
            excerpt: ai.excerpt,
            author: "RadioCiclismo Reporter",
            publishAt: publishDate.toISOString(),
            is_published: false
          }, { headers: { Cookie: sessionCookie } });
        }
      });
    }
  }
);
