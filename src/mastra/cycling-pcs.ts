import { inngest } from "./inngest.js";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

// Configurazione basi
const RC_BASE = "https://radiociclismo.com";
const PCS_BASE = "https://www.procyclingstats.com";

// Rotazione stili editoriale
const STILI = [
  { id: "EPICO_NARRATORE", prompt: "Stile L'EPICO NARRATORE — Focus su resilienza, fatica e narrazione epica del finale." },
  { id: "SPECIALISTA_TECNICO", prompt: "Stile LO SPECIALISTA TECNICO — Focus su tattica, treni dei velocisti e pendenze." },
  { id: "FLASH_NEWS", prompt: "Stile IL CRONISTA FLASH — Focus su fatti nudi, immediatezza e distacchi." },
  { id: "TECH_GURU", prompt: "Stile IL TECH-GURU — Focus su aerodinamica, materiali e dati di performance." },
  { id: "ANALISI_SQUADRA", prompt: "Stile ANALISI SQUADRA — Focus sul lavoro dei gregari e la strategia del team." }
];

// --- UTILS ---

async function getSessionCookie(): Promise<string> {
  try {
    const res = await axios.post(`${RC_BASE}/api/admin/login`, 
      { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD },
      { headers: { "Content-Type": "application/json" }, maxRedirects: 0 }
    );
    return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
  } catch { return ""; }
}

function fetchPage(url: string): string {
  try {
    // User-agent realistico per evitare blocchi da PCS
    const cmd = `curl -s -L --http2 --max-time 30 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36" -H "Referer: https://www.procyclingstats.com/" --compressed "${url}"`;
    return execSync(cmd, { maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (e: any) { 
    return `ERRORE: ${e.message}`; 
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// --- 1. DISPATCHER: Monitoraggio Calendario ---

export const cyclingDispatchFn = inngest.createFunction(
  { id: "cycling-dispatch", name: "RadioCiclismo — PCS Dispatcher" },
  { event: "cycling/generate.article" },
  async ({ step }) => {
    const gareOggi = await step.run("scraping-calendario", async () => {
      // Controlla le gare di oggi e ieri per non perdere nulla
      const oggi = new Date().toISOString().split("T")[0];
      const html = await fetchPage(`${PCS_BASE}/races.php?date=${oggi}`);
      const $ = cheerio.load(html);
      const trovate: any[] = [];

      $("table.basic tbody tr").each((i, el) => {
        const link = $(el).find("a[href^='race/']").first();
        const winner = $(el).find("td").last().text().trim();
        
        // Verifica se la gara è conclusa (presenza di un vincitore e non di un orario)
        if (link.attr("href") && winner && !winner.includes(":") && winner !== "") {
          trovate.push({
            nome: link.text().trim(),
            url: link.attr("href"),
            genere: link.text().toLowerCase().includes("women") ? "women" : "men"
          });
        }
      });
      return trovate;
    });

    if (gareOggi.length === 0) return { msg: "Nessun risultato definitivo trovato." };

    // Lancio worker individuali (Fan-out)
    const events = gareOggi.map((g, i) => ({
      name: "cycling/process.single.race",
      data: { gara: g, index: i } 
    }));

    await step.sendEvent("trigger-pcs-workers", events);
    return { dispatched: gareOggi.length };
  }
);

// --- 2. WORKER: Elaborazione Gara Internazionale ---

export const cyclingProcessRaceFn = inngest.createFunction(
  { 
    id: "cycling-worker", 
    name: "RadioCiclismo — PCS Worker",
    concurrency: 2 // Limite per piano Free Inngest
  },
  { event: "cycling/process.single.race" },
  async ({ event, step }) => {
    const { gara, index } = event.data;
    const raceSlug = slugify(gara.nome);
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

    // 1. Controllo Duplicati via API
    const exists = await step.run(`check-exists-${raceSlug}`, async () => {
      const res = await axios.get(`${RC_BASE}/api/admin/articles?search=${encodeURIComponent(gara.nome.substring(0,15))}`, 
        { headers: { Cookie: sessionCookie } }
      );
      const list = res.data?.articles || res.data || [];
      return list.some((a: any) => a.title.toLowerCase().includes(gara.nome.toLowerCase().substring(0,10)));
    });

    if (exists) return { status: "skipped", reason: "duplicate" };

    // 2. Scraping Dettagli Risultati
    const dati = await step.run(`scrape-results-${raceSlug}`, async () => {
      const html = await fetchPage(`${PCS_BASE}/${gara.url}`);
      const $ = cheerio.load(html);
      const classifica: any[] = [];
      const gc: any[] = [];

      // Tabella risultati (Tappa o Classica)
      $("table.results tbody tr").each((i, el) => {
        const nome = $(el).find("td:nth-child(2)").text().trim();
        const team = $(el).find("td:nth-child(3)").text().trim();
        const time = $(el).find("td:nth-child(4)").text().trim();
        const gcPos = $(el).find('td[data-code="gc"]').text().trim(); // Colonna Classifica Generale se presente

        if (nome && i < 15 && !/^\d+$/.test(nome)) {
          classifica.push({ pos: i + 1, nome, team, time });
          if (gcPos) gc.push({ pos: gcPos, nome, team });
        }
      });

      return { 
        classifica, 
        gc, 
        isComplete: classifica.length >= 5 
      };
    });

    if (!dati.isComplete) return { status: "skipped", reason: "insufficient_data" };

    // 3. Generazione Articolo in Italiano
    const stile = STILI[index % STILI.length];
    const articoloIT = await step.run(`gen-it-${raceSlug}`, async () => {
      const res = await generateObject({
        model: google("gemini-1.5-flash"),
        prompt: `Sei un giornalista di RadioCiclismo. Scrivi un articolo sulla gara: ${gara.nome}. 
        Vincitore: ${dati.classifica[0].nome} (${dati.classifica[0].team}). 
        Top 10: ${dati.classifica.slice(0,10).map(r => `${r.pos}. ${r.nome}`).join(", ")}.
        ${stile.prompt} 
        Usa un tono professionale. Includi una breve analisi del risultato.`,
        schema: z.object({ 
          titolo: z.string(), 
          contenuto: z.string(), 
          excerpt: z.string(), 
          slug: z.string(), 
          tags: z.array(z.string()) 
        })
      });
      return res.object;
    });

    // 4. Traduzione in Inglese
    const articoloEN = await step.run(`gen-en-${raceSlug}`, async () => {
      const res = await generateObject({
        model: google("gemini-1.5-flash"),
        prompt: `Translate the following cycling article to professional English:
        Title: ${articoloIT.titolo}
        Content: ${articoloIT.contenuto}
        Keep the technical cycling terminology correct.`,
        schema: z.object({ 
          titolo: z.string(), 
          contenuto: z.string(), 
          excerpt: z.string() 
        })
      });
      return res.object;
    });

    // 5. Pubblicazione Finale (come Bozza)
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
        published: false, // Pubblicato come bozza per revisione
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
