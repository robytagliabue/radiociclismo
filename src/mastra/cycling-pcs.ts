import { inngest } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";

const RC_BASE = "https://radiociclismo.com";

const slugify = (text: string) => 
  text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');

async function getSessionCookie(): Promise<string> {
  try {
    const res = await axios.post(`${RC_BASE}/api/admin/login`, 
      { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD },
      { headers: { "Content-Type": "application/json" } }
    );
    return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
  } catch { return ""; }
}

// ✅ IMPORTANTE: Esportazione esplicita per evitare SyntaxError
export const cyclingDispatchFn = inngest.createFunction(
  { id: "cycling-dispatch", name: "RadioCiclismo — PCS Dispatcher" },
  { event: "cycling/generate.article" },
  async ({ step }) => {
    // Qui puoi inserire la logica per recuperare le gare del giorno
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

    const articoloIT = await step.run(`gen-it-${raceSlug}`, async () => {
      const res = await (cyclingAgent as any).generateLegacy(
        `Scrivi un articolo professionale per RadioCiclismo: ${gara.nome}. Analizza tattica e distacchi. RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "", "tags": [] }`
      );
      return res?.object || res;
    });

    await step.run(`publish-${raceSlug}`, async () => {
      if (articoloIT && sessionCookie) {
        const payload = {
          slug: raceSlug,
          title: articoloIT.titolo || articoloIT.title,
          titleEn: null,
          excerpt: articoloIT.excerpt,
          excerptEn: null,
          content: articoloIT.contenuto || articoloIT.content,
          contentEn: null,
          coverImageUrl: null,
          images: [],
          hashtags: articoloIT.tags || [],
          author: "Claude Sonnet",
          publishAt: new Date().toISOString()
        };

        await axios.post(`${RC_BASE}/api/admin/articles`, payload, {
          headers: { Cookie: sessionCookie, "Content-Type": "application/json" }
        });
      }
      return { success: true };
    });

    return { status: "published", race: gara.nome };
  }
);
