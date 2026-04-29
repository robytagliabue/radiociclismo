import { inngest } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import { z } from "zod";
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

// --- UTILS (Slugify e altro) ---
const slugify = (text: string) => text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

const STILI = [
  { name: "Tecnico", prompt: "Analizza i distacchi e la tattica delle squadre." },
  { name: "Epico", prompt: "Enfatizza la fatica e l'impresa sportiva." },
  { name: "Cronaca", prompt: "Fornisci un resoconto asciutto e preciso dei fatti." }
];

// --- 1. DISPATCHER: Trova le gare (Deve essere ESPORTATA) ---
export const cyclingDispatchFn = inngest.createFunction(
  { id: "cycling-dispatch", name: "RadioCiclismo — PCS Dispatcher" },
  { event: "cycling/generate.article" },
  async ({ step }) => {
    // Qui andrebbe la tua logica di scraping iniziale per trovare la lista gare
    // Esempio semplificato:
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

// --- 2. WORKER: Elaborazione Gara (Deve essere ESPORTATA) ---
export const cyclingProcessRaceFn = inngest.createFunction(
  { 
    id: "cycling-worker", 
    name: "RadioCiclismo — PCS Worker",
    concurrency: 2 
  },
  { event: "cycling/process.single.race" },
  async ({ event, step }) => {
    const { gara, index } = event.data;
    const raceSlug = slugify(gara.nome);

    // Mock dei dati (Sostituisci con il tuo scraping reale)
    const dati = {
      isComplete: true,
      classifica: [{ pos: 1, nome: "Pogačar", team: "UAE" }]
    };

    if (!dati.isComplete) return { status: "skipped", reason: "insufficient_data" };

    const stile = STILI[index % STILI.length];

    // 3. GENERAZIONE ARTICOLO IT CON AGENTE MASTRA
    const articoloIT = await step.run(`gen-it-${raceSlug}`, async () => {
      const res = await cyclingAgent.generate({
        prompt: `Sei un giornalista di RadioCiclismo. Scrivi un articolo sulla gara: ${gara.nome}. 
        Vincitore: ${dati.classifica[0].nome} (${dati.classifica[0].team}). 
        Top 10: ${dati.classifica.slice(0,10).map(r => `${r.pos}. ${r.nome}`).join(", ")}.
        ${stile.prompt} 
        Genera un JSON con: titolo, contenuto, excerpt, slug, tags (array).`,
      });
      
      // Mastra restituisce l'oggetto in .object se hai definito lo schema nell'agente
      return res.object as any; 
    });

    // 4. TRADUZIONE EN CON AGENTE MASTRA
    const articoloEN = await step.run(`gen-en-${raceSlug}`, async () => {
      const res = await cyclingAgent.generate({
        prompt: `Translate the following cycling article to professional English:
        Title: ${articoloIT.titolo}
        Content: ${articoloIT.contenuto}
        Keep technical cycling terminology correct. Return JSON with: titolo, contenuto, excerpt.`,
      });
      return res.object as any;
    });

    // 5. PUBBLICAZIONE (Invariata)
    const pub = await step.run(`publish-${raceSlug}`, async () => {
      // Nota: Qui puoi aggiungere la logica axios per il tuo backend
      return { id: "mock-id-123", success: true };
    });

    return { status: "success", id: pub.id, race: gara.nome };
  }
);
