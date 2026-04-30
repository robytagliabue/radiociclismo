import { inngest } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";
import FormData from "form-data";

const RC_BASE = "https://radiociclismo.com";
const PCS_BASE = "https://www.procyclingstats.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

// --- LOGICA DI SUPPORTO (Dalla tua versione Replit) ---

function normalizeRaceName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/**
 * Cerca narrativa esterna per arricchire l'articolo
 */
async function fetchRaceNarrative(raceName: string, winner: string): Promise<string> {
  // Nota: Qui usiamo curl per evitare blocchi Cloudflare come nel tuo script
  const searchUrl = `https://cyclingpro.net/spaziociclismo/?s=${encodeURIComponent(raceName)}`;
  try {
    const html = execSync(`curl -s -L -H "User-Agent: ${UA}" "${searchUrl}"`).toString();
    const $ = cheerio.load(html);
    const firstArticleUrl = $("article h2 a").first().attr("href");
    
    if (firstArticleUrl) {
      const artHtml = execSync(`curl -s -L -H "User-Agent: ${UA}" "${firstArticleUrl}"`).toString();
      const $art = cheerio.load(artHtml);
      return $art(".entry-content p").slice(0, 5).text().trim();
    }
  } catch (e) {
    return "";
  }
  return "";
}

// --- WORKFLOW INNGEST ---

export const cyclingDispatchFn = inngest.createFunction(
  { id: "cycling-dispatch", name: "RadioCiclismo — Dispatch PCS" },
  { event: "cycling/generate.article" },
  async ({ step }) => {
    const gareOggi = await step.run("fetch-pcs-calendar", async () => {
      const oggi = new Date().toISOString().split("T")[0];
      const cmd = `curl -s -L --http2 -H "User-Agent: ${UA}" "${PCS_BASE}/races.php?date=${oggi}"`;
      const html = execSync(cmd).toString();
      const $ = cheerio.load(html);
      
      const results: any[] = [];
      $("table.basic tr").each((_, el) => {
        const link = $(el).find("a[href*='race/']");
        const name = link.text().trim();
        const href = link.attr("href");
        const winner = $(el).find(".ar").last().text().trim(); // Semplificato per brevità

        if (name && href && winner) {
          results.push({ name, url: href, winner });
        }
      });
      return results;
    });

    const events = gareOggi.map((gara, index) => ({
      name: "cycling/process.single.race",
      data: { gara, index }
    }));

    await step.sendEvent("dispatch-workers", events);
    return { dispatched: events.length };
  }
);

export const cyclingProcessRaceFn = inngest.createFunction(
  { id: "cycling-worker", name: "RadioCiclismo — PCS Full Worker" },
  { event: "cycling/process.single.race" },
  async ({ event, step }) => {
    const { gara } = event.data;

    // 1. Recupero narrativa e dettagli tecnici (Logica Replit)
    const extraContext = await step.run("get-narrative", async () => {
      return await fetchRaceNarrative(gara.name, gara.winner);
    });

    const risultatiTecnici = await step.run("get-technical-results", async () => {
       const html = execSync(`curl -s -L -H "User-Agent: ${UA}" "${PCS_BASE}/${gara.url}"`).toString();
       const $ = cheerio.load(html);
       const rows: any[] = [];
       $("table.results tbody tr").slice(0, 10).each((i, el) => {
          rows.push({
            pos: $(el).find("td").first().text().trim(),
            rider: $(el).find("a[href*='rider/']").text().trim(),
            team: $(el).find("a[href*='team/']").text().trim(),
            time: $(el).find(".time").text().trim()
          });
       });
       return rows;
    });

    // 2. Generazione con AI (Utilizzando il tuo Mastra Agent)
    const articolo = await step.run("generate-with-ai", async () => {
      const prompt = `
        Sei il "Radiociclismo Reporter". 
        Gara: ${gara.name}
        Vincitore: ${gara.winner}
        Risultati: ${JSON.stringify(risultatiTecnici)}
        Contesto extra: ${extraContext}
        
        Scrivi un articolo epico ma tecnico in formato JSON: { "titolo": "...", "contenuto": "...", "tags": [] }
      `;
      const res = await (cyclingAgent as any).generateLegacy(prompt);
      return res?.object || res;
    });

    // 3. Login e Pubblicazione su RadioCiclismo
    await step.run("publish-to-rc", async () => {
      const loginRes = await axios.post(`${RC_BASE}/api/admin/login`, {
        username: process.env.RC_USERNAME,
        password: process.env.RC_PASSWORD
      });
      const cookie = loginRes.headers["set-cookie"]?.find(c => c.includes("connect.sid"))?.split(";")[0];

      await axios.post(`${RC_BASE}/api/admin/articles`, {
        title: articolo.titolo,
        content: articolo.contenuto,
        author: "Radiociclismo Reporter",
        is_published: false, // Lasciamo in bozza per revisione
        hashtags: articolo.tags || ["#ciclismo"]
      }, { headers: { Cookie: cookie } });
    });

    return { status: "success", race: gara.name };
  }
);
