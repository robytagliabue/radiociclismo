import { inngest } from "./inngest.js";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import axios from "axios";
import FormData from "form-data";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";
const PCS_BASE = "https://www.procyclingstats.com";

const STILI = [
  { id: "EPICO_NARRATORE", prompt: "Stile L'EPICO NARRATORE — Focus su resilienza e narrazione epica." },
  { id: "SPECIALISTA_TECNICO", prompt: "Stile LO SPECIALISTA TECNICO — Focus su tattica e dinamiche di corsa." },
  { id: "FLASH_NEWS", prompt: "Stile IL CRONISTA FLASH — Focus su fatti nudi e immediatezza." },
  { id: "TECH_GURU", prompt: "Stile IL TECH-GURU — Focus su performance e materiali." },
  { id: "ANALISI_SQUADRA", prompt: "Stile ANALISI SQUADRA — Focus sul lavoro dei gregari." }
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

async function fetchPage(url: string): Promise<string> {
  try {
    // Rimosso -4, aggiunto timeout e headers realistici
    const cmd = `curl -s -L --http2 --max-time 30 -H "Referer: https://www.procyclingstats.com/" --compressed "${url}"`;
    return execSync(cmd, { maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (e: any) { return `ERRORE: ${e.message}`; }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// --- 1. DISPATCHER: Scansiona e lancia i worker ---

export const cyclingDispatchFn = inngest.createFunction(
  { id: "cycling-dispatch", name: "RadioCiclismo — Dispatcher" },
  { event: "cycling/generate.article" },
  async ({ step }) => {
    const gareOggi = await step.run("scraping-calendario", async () => {
      const ieri = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const html = await fetchPage(`${PCS_BASE}/races.php?date=${ieri}`);
      const $ = cheerio.load(html);
      const trovate: any[] = [];

      $("table.basic tbody tr").each((i, el) => {
        const link = $(el).find("a[href^='race/']").first();
        const winner = $(el).find("td").last().text().trim();
        // Se c'è un vincitore e non è un orario (es 15:00), la gara è finita
        if (link.attr("href") && winner && !winner.includes(":")) {
          trovate.push({
            nome: link.text().trim(),
            url: link.attr("href"),
            genere: link.text().toLowerCase().includes("women") ? "women" : "men"
          });
        }
      });
      return trovate;
    });

    if (gareOggi.length === 0) return { msg: "Nessuna gara finita trovata." };

    // Lancio "a ventaglio" (Fan-out) per elaborazione parallela
    const events = gareOggi.map((g, i) => ({
      name: "cycling/process.single.race",
      data: { gara: g, index: i } 
    }));

    await step.sendEvent("trigger-workers", events);
    return { dispatched: gareOggi.length };
  }
);

// --- 2. WORKER: Elabora la singola gara ---

export const cyclingProcessRaceFn = inngest.createFunction(
  { id: "cycling-worker", name: "RadioCiclismo — Worker Gara", concurrency: 2 },
  { event: "cycling/process.single.race" },
  async ({ event, step }) => {
    const { gara, index } = event.data;
    const raceSlug = slugify(gara.nome);
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

    // Check duplicati (Semplificato)
    const exists = await step.run(`check-exists-${raceSlug}`, async () => {
      const res = await axios.get(`${RC_BASE}/api/admin/articles?search=${encodeURIComponent(gara.nome.substring(0,15))}`, { headers: { Cookie: sessionCookie } });
      const list = res.data?.articles || res.data || [];
      return list.some((a: any) => a.title.toLowerCase().includes(gara.nome.toLowerCase().substring(0,10)));
    });

    if (exists) return { status: "skipped", reason: "duplicate" };

    // Scraping Risultati + GC (Dallo stesso HTML)
    const dati = await step.run(`scrape-${raceSlug}`, async () => {
      const html = await fetchPage(`${PCS_BASE}/${gara.url}`);
      const $ = cheerio.load(html);
      const classifica: any[] = [];
      const gc: any[] = [];

      // Estrazione Classifica Tappa
      $("table.results tbody tr").each((i, el) => {
        const nome = $(el).find("td:nth-child(2)").text().trim();
        const team = $(el).find("td:nth-child(3)").text().trim();
        const time = $(el).find("td:nth-child(4)").text().trim();
        const gcData = $(el).find('td[data-code="gc"]').text().trim(); // GC Column

        if (nome && i < 20 && !/^\d+$/.test(nome)) {
          classifica.push({ pos: i + 1, nome, team, time });
          if (gcData) gc.push({ pos: gcData, nome, team });
        }
      });

      return { classifica, gc, isComplete: classifica.length >= 8 || $(".dsq, .dnf").length > 0 };
    });

    if (!dati.isComplete) return { status: "skipped", reason: "partial_results" };

    // Generazione Articolo IT
    const stile = STILI[index % STILI.length];
    const articoloIT = await step.run(`gen-it-${raceSlug}`, async () => {
      const res = await generateObject({
        model: google("gemini-1.5-flash"),
        prompt: `Scrivi un articolo di ciclismo: ${gara.nome}. Vincitore: ${dati.classifica[0].nome}. Top 10: ${dati.classifica.slice(0,10).map(r => r.nome).join(", ")}. Stile: ${stile.prompt}. NON inventare dati.`,
        schema: z.object({ titolo: z.string(), contenuto: z.string(), excerpt: z.string(), slug: z.string(), tags: z.array(z.string()) })
      });
      return res.object;
    });

    // Traduzione EN (Integrale)
    const articoloEN = await step.run(`gen-en-${raceSlug}`, async () => {
      const res = await generateObject({
        model: google("gemini-1.5-flash"),
        prompt: `Translate this to professional English: ${articoloIT.titolo} \n\n ${articoloIT.contenuto}. Translate EVERYTHING.`,
        schema: z.object({ titolo: z.string(), contenuto: z.string(), excerpt: z.string() })
      });
      return res.object;
    });

    // Pubblicazione
    const pub = await step.run(`publish-${raceSlug}`, async () => {
      const body = {
        slug: articoloIT.slug, title: articoloIT.titolo, content: articoloIT.contenuto, excerpt: articoloIT.excerpt,
        titleEn: articoloEN.titolo, contentEn: articoloEN.contenuto, excerptEn: articoloEN.excerpt,
        author: "AI Agent", published: false, hashtags: articoloIT.tags
      };
      const res = await axios.post(`${RC_BASE}/api/admin/articles`, body, { headers: { Cookie: sessionCookie } });
      return res.data;
    });

    return { status: "success", id: pub.id || pub._id };
  }
);
