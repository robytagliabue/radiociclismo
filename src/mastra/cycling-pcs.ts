import { inngest } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";

const RC_BASE = "https://radiociclismo.com";
const slugify = (text: string) => text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

async function getSessionCookie(): Promise<string> {
  try {
    const res = await axios.post(`${RC_BASE}/api/admin/login`, 
      { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD },
      { headers: { "Content-Type": "application/json" } }
    );
    return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
  } catch { return ""; }
}

export const cyclingDispatchFn = inngest.createFunction(
  { id: "cycling-dispatch", name: "RadioCiclismo — PCS Dispatcher" },
  { event: "cycling/generate.article" },
  async ({ step }) => {
    // Qui andrebbe lo scraping reale della home di PCS
    const gare = [{ nome: "Esempio Gara Pro", id: "1" }]; 
    for (const [index, gara] of gare.entries()) {
      await step.sendEvent(`process-race-${index}`, {
        name: "cycling/process.single.race",
        data: { gara, index },
      });
    }
    return { dispatched: gare.length };
  }
);

export const cyclingProcessRaceFn = inngest.createFunction(
  { id: "cycling-worker", name: "RadioCiclismo — PCS Worker", concurrency: 2 },
  { event: "cycling/process.single.race" },
  async ({ event, step }) => {
    const { gara } = event.data;
    const raceSlug = slugify(gara.nome);
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

    // 1. Generazione Articolo Italiano
    const articoloIT = await step.run(`gen-it-${raceSlug}`, async () => {
      const res = await (cyclingAgent as any).generateLegacy(
        `Scrivi un articolo per RadioCiclismo: ${gara.nome}. Vincitore: Tadej Pogačar. 
        Analizza i distacchi. RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "", "slug": "", "tags": [] }`
      );
      return res?.object || res;
    });

    // 2. Traduzione Inglese
    const articoloEN = await step.run(`gen-en-${raceSlug}`, async () => {
      const res = await (cyclingAgent as any).generateLegacy(
        `Translate this to English: ${JSON.stringify(articoloIT)}. 
        RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "" }`
      );
      return res?.object || res;
    });

    // 3. Pubblicazione sul Database Reale
    await step.run(`publish-${raceSlug}`, async () => {
      await axios.post(`${RC_BASE}/api/admin/articles`, {
        slug: raceSlug,
        title: articoloIT.titolo,
        content: articoloIT.contenuto,
        excerpt: articoloIT.excerpt,
        author: "Claude AI",
        published: false,
        hashtags: articoloIT.tags
      }, { headers: { Cookie: sessionCookie } });
      
      return { success: true };
    });

    return { status: "published_draft", race: gara.nome };
  }
);
