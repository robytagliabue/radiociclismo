import { inngest } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";

// --- UTILS ---
const slugify = (text: string) => 
  text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

const STILI = [
  { name: "Tecnico", prompt: "Analizza i distacchi e la tattica delle squadre." },
  { name: "Epico", prompt: "Enfatizza la fatica e l'impresa sportiva." },
  { name: "Cronaca", prompt: "Fornisci un resoconto asciutto e preciso dei fatti." }
];

// --- 1. DISPATCHER ---
export const cyclingDispatchFn = inngest.createFunction(
  { id: "cycling-dispatch", name: "RadioCiclismo — PCS Dispatcher" },
  { event: "cycling/generate.article" },
  async ({ step }) => {
    const gare = [{ nome: "Esempio Gara", id: "123" }]; 

    for (const [index, gara] of gare.entries()) {
      await step.sendEvent(`process-race-${index}`, {
        name: "cycling/process.single.race",
        data: { gara, index },
      });
    }
    return { dispatched: gare.length };
  }
);

// --- 2. WORKER ---
export const cyclingProcessRaceFn = inngest.createFunction(
  { id: "cycling-worker", name: "RadioCiclismo — PCS Worker", concurrency: 2 },
  { event: "cycling/process.single.race" },
  async ({ event, step }) => {
    const { gara, index } = event.data;
    const raceSlug = slugify(gara.nome);

    const dati = {
      isComplete: true,
      classifica: [{ pos: 1, nome: "Tadej Pogačar", team: "UAE Team Emirates" }]
    };

    const stile = STILI[index % STILI.length];

    // GENERAZIONE ARTICOLO IT
    const articoloIT = await step.run(`gen-it-${raceSlug}`, async () => {
      const res = await cyclingAgent.generateLegacy({
        messages: [
          {
            role: "user",
            content: `Sei un giornalista di RadioCiclismo. Scrivi un articolo sulla gara: ${gara.nome}. 
            Vincitore: ${dati.classifica[0].nome}. ${stile.prompt} 
            RITORNA SOLO JSON: { "titolo": "", "contenuto": "", "excerpt": "", "slug": "", "tags": [] }`
          }
        ]
      });
      return (res as any).object || res;
    });

    // TRADUZIONE EN
    const articoloEN = await step.run(`gen-en-${raceSlug}`, async () => {
      const res = await cyclingAgent.generateLegacy({
        messages: [
          {
            role: "user",
            content: `Translate to English: ${JSON.stringify(articoloIT)}. Return JSON.`
          }
        ]
      });
      return (res as any).object || res;
    });

    await step.run(`publish-${raceSlug}`, async () => {
      console.log(`🚀 Articolo RadioCiclismo pronto: ${articoloIT.titolo}`);
      return { success: true };
    });

    return { status: "success", race: gara.nome };
  }
);
