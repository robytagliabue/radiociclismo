import { inngest } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";

const RC_BASE = "https://radiociclismo.com";

// Helper per creare slug URL-friendly
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

export const cyclingProcessRaceFn = inngest.createFunction(
  { id: "cycling-worker", name: "RadioCiclismo — PCS Worker", concurrency: 2 },
  { event: "cycling/process.single.race" },
  async ({ event, step }) => {
    const { gara } = event.data;
    const raceSlug = slugify(gara.nome);
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

    const articoloIT = await step.run(`gen-it-${raceSlug}`, async () => {
      const res = await (cyclingAgent as any).generateLegacy(
        `Scrivi un articolo professionale per RadioCiclismo sulla gara: ${gara.nome}. 
        Analizza tattica e distacchi. RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "", "tags": [] }`
      );
      return res?.object || res;
    });

    await step.run(`publish-${raceSlug}`, async () => {
      if (articoloIT && sessionCookie) {
        // Payload costruito esattamente sullo schema insertArticleSchema
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
          publishAt: new Date().toISOString() // Obbligatorio per lo schema
        };

        await axios.post(`${RC_BASE}/api/admin/articles`, payload, {
          headers: { 
            Cookie: sessionCookie,
            "Content-Type": "application/json"
          }
        });
      }
      return { success: true };
    });

    return { status: "published", race: gara.nome };
  }
);
