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

export const cyclingDispatchFn = inngest.createFunction(
  { id: "cycling-dispatch", name: "RadioCiclismo — PCS Dispatcher" },
  { event: "cycling/generate.article" },
  async ({ step }) => {
    const gare = [{ nome: "Esempio Gara Pro", id: "1" }]; 
    for (const [index, gara] of gare.entries()) {
      await step.sendEvent(`process-race-${index}`, {
        name: "cycling/process.single.race",
        data: { gara },
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
        `Scrivi un articolo professionale per RadioCiclismo: ${gara.nome}. Non usare titoli generici come "test". RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "", "tags": [] }`
      );
      return res?.object || res;
    });

    await step.run(`publish-${raceSlug}`, async () => {
      if (!articoloIT || !sessionCookie) return { skipped: true };

      // CALCOLO RITARDO: Ora attuale + 2 ore
      const scheduledTime = new Date();
      scheduledTime.setHours(scheduledTime.getHours() + 2);

      const payload = {
        slug: raceSlug,
        title: articoloIT.titolo || "Articolo Ciclismo",
        titleEn: "",
        excerpt: articoloIT.excerpt || "",
        excerptEn: "",
        content: articoloIT.contenuto || "",
        contentEn: "",
        coverImageUrl: "",
        images: [],
        hashtags: articoloIT.tags || [],
        author: "Claude Sonnet",
        publishAt: scheduledTime.toISOString() // Data programmata tra 2 ore
      };

      try {
        // Invio al database (lo schema del tuo server mette isPublished: false di default)
        await axios.post(`${RC_BASE}/api/admin/articles`, payload, {
          headers: { Cookie: sessionCookie, "Content-Type": "application/json" }
        });
      } catch (err: any) {
        console.error("ERRORE INVIO:", err.response?.data);
        throw err;
      }
      return { success: true, scheduledFor: scheduledTime.toISOString() };
    });

    return { status: "scheduled", race: gara.nome };
  }
);
