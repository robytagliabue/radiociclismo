import { inngest } from "./client.js"; // Modificato per puntare al client centralizzato
import { cyclingAgent } from "./cyclingAgent.js"; // 1. IMPORTA IL TUO AGENTE
import { google } from "@ai-sdk/google";
import { z } from "zod";
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

// ... (Resto della configurazione e Utils rimane invariato) ...

// --- 2. WORKER: Elaborazione Gara Internazionale ---

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
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

    // ... (Controllo duplicati e Scraping rimangono invariati) ...

    if (!dati.isComplete) return { status: "skipped", reason: "insufficient_data" };

    // 3. GENERAZIONE ARTICOLO CON AGENTE MASTRA
    const stile = STILI[index % STILI.length];
    const articoloIT = await step.run(`gen-it-${raceSlug}`, async () => {
      // USIAMO L'AGENTE INVECE DI generateObject
      const res = await cyclingAgent.generate({
        prompt: `Sei un giornalista di RadioCiclismo. Scrivi un articolo sulla gara: ${gara.nome}. 
        Vincitore: ${dati.classifica[0].nome} (${dati.classifica[0].team}). 
        Top 10: ${dati.classifica.slice(0,10).map(r => `${r.pos}. ${r.nome}`).join(", ")}.
        ${stile.prompt} 
        Usa un tono professionale. Includi una breve analisi del risultato.`,
      });
      
      // Mastra restituisce l'oggetto validato direttamente in .text o .object a seconda della config
      // Se hai definito outputs nell'agente, usa res.object
      return res.object; 
    });

    // 4. TRADUZIONE (Puoi usare l'agente anche qui o restare con generateObject)
    const articoloEN = await step.run(`gen-en-${raceSlug}`, async () => {
      const res = await cyclingAgent.generate({
        prompt: `Translate the following cycling article to professional English:
        Title: ${articoloIT.titolo}
        Content: ${articoloIT.contenuto}
        Keep the technical cycling terminology correct.`,
      });
      return res.object;
    });

    // 5. PUBBLICAZIONE (Invariata)
    const pub = await step.run(`publish-${raceSlug}`, async () => {
      const body = {
        slug: articoloIT.slug,
        title: articoloIT.titolo,
        content: articoloIT.contenuto,
        excerpt: articoloIT.excerpt,
        titleEn: articoloEN.titolo,
        contentEn: articoloEN.contenuto,
        excerptEn: articoloEN.excerpt,
        author: "RadioCiclismo AI",
        published: false,
        hashtags: articoloIT.tags
      };
      
      const res = await axios.post(`${RC_BASE}/api/admin/articles`, body, { 
        headers: { Cookie: sessionCookie } 
      });
      return res.data;
    });

    return { status: "success", id: pub.id || pub._id, race: gara.nome };
  }
);
