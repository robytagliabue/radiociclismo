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

// 1. DISPATCHER: Invia le gare al worker
export const cyclingDispatchFn = inngest.createFunction(
  { id: "cycling-dispatch", name: "RadioCiclismo — PCS Dispatcher" },
  { event: "cycling/generate.article" },
  async ({ step }) => {
    // Qui andrebbe la logica di scraping PCS. Per ora usiamo i dati in ingresso o l'esempio.
    const gare = [
      { nome: "Gara Esempio Pro", id: "sample-1", details: "Dettagli della gara..." }
    ]; 

    for (const [index, gara] of gare.entries()) {
      await step.sendEvent(`process-race-${index}`, {
        name: "cycling/process.single.race",
        data: { gara },
      });
    }
    return { dispatched: gare.length };
  }
);

// 2. WORKER: Elabora la singola gara e pubblica con ritardo
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
        Dettagli: ${gara.details || ''}.
        IMPORTANTE: Non usare titoli di test. Scrivi un pezzo giornalistico completo.
        RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "", "tags": [] }`
      );
      return res?.object || res;
    });

    await step.run(`publish-${raceSlug}`, async () => {
      // Controllo qualità: non pubblichiamo se il contenuto è scarso o assente
      if (!articoloIT || !articoloIT.contenuto || articoloIT.contenuto.length < 100 || !sessionCookie) {
        return { skipped: true, reason: "Contenuto non idoneo o sessione mancante" };
      }

      // PROGRAMMAZIONE: +2 ore
      const scheduledTime = new Date();
      scheduledTime.setHours(scheduledTime.getHours() + 2);

      const payload = {
        slug: `${raceSlug}-${Date.now()}`,
        title: articoloIT.titolo || gara.nome,
        titleEn: "",
        excerpt: articoloIT.excerpt || "",
        excerptEn: "",
        content: articoloIT.contenuto,
        contentEn: "",
        coverImageUrl: "",
        images: [],
        hashtags: articoloIT.tags || ["#ciclismo", "#procycling"],
        author: "Claude Sonnet",
        publishAt: scheduledTime.toISOString()
      };

      try {
        await axios.post(`${RC_BASE}/api/admin/articles`, payload, {
          headers: { Cookie: sessionCookie, "Content-Type": "application/json" }
        });
      } catch (err: any) {
        console.error("ERRORE PUBBLICAZIONE GARA:", err.response?.data);
        throw err;
      }
      return { success: true, scheduledFor: scheduledTime.toISOString() };
    });

    return { status: "scheduled", race: gara.nome };
  }
);
