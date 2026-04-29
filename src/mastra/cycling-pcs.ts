import { inngest } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import { z } from "zod";
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

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
  { 
    id: "cycling-worker", 
    name: "RadioCiclismo — PCS Worker",
    concurrency: 2 
  },
  { event: "cycling/process.single.race" },
  async ({ event, step }) => {
    const { gara, index } = event.data;
    const raceSlug = slugify(gara.nome);

    const dati = {
      isComplete: true,
      classifica: [{ pos: 1, nome: "Pogačar", team: "UAE" }]
    };

    if (!dati.isComplete) return { status: "skipped", reason: "insufficient_data" };

    const stile = STILI[index % STILI.length];

    // 3. GENERAZIONE ARTICOLO IT
    const articoloIT = await step.run(`gen-it-${raceSlug}`, async () => {
      const res = await cyclingAgent.text({
        messages: [`Sei un giornalista di RadioCiclismo. Scrivi un articolo sulla gara: ${gara.nome}. 
        Vincitore: ${dati.classifica[0].nome} (${dati.classifica[0].team}). 
        Top 10: ${dati.classifica.slice(0,10).map(r => `${r.pos}. ${r.nome}`).join(", ")}.
        ${stile.prompt} 
        RISPONDI ESCLUSIVAMENTE CON UN JSON VALIDO: { "titolo": "", "contenuto": "", "excerpt": "", "slug": "", "tags": [] }`]
      });
      
      try {
        const cleanText = res.text.replace(/```json|```/g, "").trim();
        return JSON.parse(cleanText);
      } catch (e) {
        return { titolo: gara.nome, contenuto: res.text, slug: raceSlug, tags: ["ciclismo"] };
      }
    });

    // 4. TRADUZIONE EN
    const articoloEN = await step.run(`gen-en-${raceSlug}`, async () => {
      const res = await cyclingAgent.text({
        messages: [`Translate this cycling article to English. Return ONLY JSON: { "titolo": "", "contenuto": "", "excerpt": "" }. 
        Article: ${JSON.stringify(articoloIT)}`]
      });
      try {
        const cleanText = res.text.replace(/```json|```/g, "").trim();
        return JSON.parse(cleanText);
      } catch (e) {
        return { titolo: articoloIT.titolo, contenuto: res.text };
      }
    });

    // 5. PUBBLICAZIONE
    const pub = await step.run(`publish-${raceSlug}`, async () => {
      console.log(`🚀 Articolo generato: ${articoloIT.titolo}`);
      return { id: "success-id", success: true };
    });

    return { status: "success", id: pub.id, race: gara.nome };
  }
);
