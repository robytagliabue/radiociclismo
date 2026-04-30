import { inngest } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";

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
    // Qui andrebbe la logica di recupero gare reali da PCS
    const gare = [{ nome: "Gara Esempio Pro", id: "sample-1", results: [] }]; 

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

    // --- STEP 1: UPLOAD DATI TECNICI (Sempre, se non presenti) ---
    await step.run(`upload-technical-data-${raceSlug}`, async () => {
      if (!gara.results || gara.results.length === 0) return { status: "no_results" };

      try {
        await axios.post(`${RC_BASE}/api/admin/race-results`, {
          raceName: gara.nome,
          slug: raceSlug,
          results: gara.results
        }, { headers: { Cookie: sessionCookie } });
        return { status: "results_uploaded" };
      } catch (err: any) {
        if (err.response?.status === 400) return { status: "already_exists" };
        throw err;
      }
    });

    // --- STEP 2: GENERAZIONE ARTICOLO (Solo se c'è sostanza) ---
    const articoloAI = await step.run(`gen-article-${raceSlug}`, async () => {
      const res = await (cyclingAgent as any).generateLegacy(
        `Scrivi un articolo professionale sulla gara: ${gara.nome}. 
        Se i dati sono insufficienti per un pezzo di valore, scrivi solo "SKIP".
        RITORNA JSON: { "titolo": "", "contenuto": "", "excerpt": "", "tags": [] }`
      );
      return res?.object || res;
    });

    // --- STEP 3: PUBBLICAZIONE (Con ritardo 2h e filtro lunghezza) ---
    await step.run(`publish-editorial-${raceSlug}`, async () => {
      if (!articoloAI || articoloAI === "SKIP" || (articoloAI.contenuto && articoloAI.contenuto.length < 200)) {
        return { status: "skipped_insufficient_content" };
      }

      const scheduledTime = new Date();
      scheduledTime.setHours(scheduledTime.getHours() + 2);

      const payload = {
        slug: `report-${raceSlug}`,
        title: articoloAI.titolo,
        content: articoloAI.contenuto,
        excerpt: articoloAI.excerpt,
        author: "RadioCiclismo AI",
        publishAt: scheduledTime.toISOString(),
        hashtags: articoloAI.tags || [],
        titleEn: "", excerptEn: "", contentEn: "", coverImageUrl: "", images: []
      };

      await axios.post(`${RC_BASE}/api/admin/articles`, payload, {
        headers: { Cookie: sessionCookie, "Content-Type": "application/json" }
      });
      return { status: "article_scheduled" };
    });
  }
);
