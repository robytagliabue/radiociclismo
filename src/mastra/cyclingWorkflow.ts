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
  { id: "EPICO_NARRATORE", prompt: "Stile L'EPICO NARRATORE — Focus sulla resilienza dell'atleta. Usa solo i dati forniti." },
  { id: "SPECIALISTA_TECNICO", prompt: "Stile LO SPECIALISTA TECNICO — Focus su tattica, attacchi e gestione gara." },
  { id: "FLASH_NEWS", prompt: "Stile IL CRONISTA FLASH — Focus su fatti, distacchi e Top 10 immediata." },
  { id: "TECH_GURU", prompt: "Stile IL TECH-GURU — Focus su performance atletica." }
];

let articoliGenerati = 0;

async function getSessionCookie(): Promise<string> {
  try {
    const res = await axios.post(`${RC_BASE}/api/admin/login`, { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD }, { headers: { "Content-Type": "application/json" }, maxRedirects: 0, validateStatus: s => s < 400 });
    return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
  } catch { return ""; }
}

async function fetchPage(url: string): Promise<string> {
  try {
    return execSync(`curl -4 -s -L --http2 --max-time 30 -H "Referer: https://www.procyclingstats.com/" --compressed "${url}"`, { maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (e: any) { return `ERRORE: ${e.message}`; }
}

// LOGICA 1: Controllo Calendario Giornaliero (One-day races o Righe Tappa nel calendario)
function parseGareFromPCS(html: string): Array<{ nome: string; url: string; genere: string }> {
  const $ = cheerio.load(html);
  const gare: Array<{ nome: string; url: string; genere: string }> = [];
  const blacklist = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "stage", "prologue", "day"];

  $("table.basic tbody tr").each((i, el) => {
    const linkGara = $(el).find("a[href^='race/']").first();
    const urlGara = linkGara.attr("href") || "";
    const nomeRaw = linkGara.text().trim();
    
    // Su PCS, se l'ultima cella della riga ha un nome (vincitore), la gara è finita.
    // Se c'è un orario (es. 15:20) o è vuota, ignoriamo.
    const winnerCell = $(el).find("td").last().text().trim();
    const isFinished = winnerCell.length > 3 && !winnerCell.includes(":") && !blacklist.some(w => winnerCell.toLowerCase().includes(w));

    if (!urlGara || !isFinished) return;

    const nomePulito = nomeRaw.split("|").pop()?.trim() || nomeRaw;
    gare.push({ 
        nome: nomePulito, 
        url: urlGara.startsWith("/") ? urlGara : "/" + urlGara, 
        genere: nomePulito.toLowerCase().includes("women") ? "women" : "men" 
    });
  });
  return gare;
}

export const cyclingWorkflowFn = inngest.createFunction(
  { id: "cycling-workflow", name: "RadioCiclismo — Automazione", concurrency: { limit: 1 } },
  { event: "cycling/generate.article" },
  async ({ event, step }) => {
    const report: any[] = [];
    const sessionCookie = await step.run("login-rc", async () => {
      const c = await getSessionCookie();
      if (!c) throw new Error("Login fallito");
      return c;
    });

    const rcGare = await step.run("fetch-rc-races", async () => (await axios.get(`${RC_BASE}/api/admin/races?status=approved`, { headers: { Cookie: sessionCookie } })).data);

    const gareOggi = await step.run("scraping-calendario", async () => {
        const html = await fetchPage(`${PCS_BASE}/races.php?date=${new Date().toISOString().split("T")[0]}`);
        return parseGareFromPCS(html);
    });

    if (gareOggi.length === 0) return { success: true, msg: "Nessuna gara terminata nel calendario" };

    for (const gara of gareOggi) {
      const garaReport: any = { nome: gara.nome, azioni: [] };
      try {
        const esiste = await step.run(`check-${gara.nome}`, async () => {
          const res = await axios.get(`${RC_BASE}/api/admin/articles?search=${encodeURIComponent(gara.nome.substring(0, 20))}`, { headers: { Cookie: sessionCookie } });
          return (res.data?.articles ?? res.data ?? []).some((a: any) => a.title?.toLowerCase().includes(gara.nome.toLowerCase().substring(0, 15)));
        });
        if (esiste) continue;

        // LOGICA 2: Controllo Pagina Risultati (Stage/Tappa)
        const risultati = await step.run(`results-${gara.nome}`, async () => {
          const html = await fetchPage(`${PCS_BASE}${gara.url}`);
          const $ = cheerio.load(html);
          
          const finisherRows: any[] = [];
          let nonFinisherCount = 0;
          const blacklistNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "stage", "day", "result"];

          $("table.results tbody tr").each((i, el) => {
            const pos = $(el).find("td:nth-child(1)").text().trim();
            const nome = $(el).find("td:nth-child(2)").text().trim();
            
            // Conta DNS, DNF, OTL, DSQ
            if (["dns", "dnf", "otl", "dsq"].some(status => pos.toLowerCase().includes(status))) {
              nonFinisherCount++;
              return;
            }

            // Filtro nomi validi
            if (nome && nome.length > 3 && !blacklistNames.some(w => nome.toLowerCase().includes(w)) && !/^\d/.test(nome)) {
              finisherRows.push({ 
                posizione: finisherRows.length + 1, 
                nome, 
                squadra: $(el).find("td:nth-child(3)").text().trim(), 
                tempo: $(el).find("td:nth-child(4)").text().trim() 
              });
            }
          });

          // APPLICAZIONE CONDIZIONI DI COMPLETAMENTO
          const hasResults = finisherRows.length > 3;
          const isRaceComplete = hasResults && (nonFinisherCount > 0 || finisherRows.length >= 80);

          return isRaceComplete ? { classifica: finisherRows } : null;
        });

        if (!risultati) {
          garaReport.azioni.push("Gara in corso (risultati parziali) — saltata");
          continue;
        }

        const stile = STILI[articoliGenerati % STILI.length];
        articoliGenerati++;

        const articoloIT = await step.run(`gen-it-${gara.nome}`, async () => {
          const vincitore = risultati.classifica[0];
          const top10 = risultati.classifica.slice(0, 10).map(r => `${r.posizione}. ${r.nome} (${r.squadra})`).join(", ");
          return (await generateObject({
            model: google("gemini-1.5-flash"),
            prompt: `Sei un giornalista sportivo. Scrivi un articolo professionale sulla gara TERMINATA: ${gara.nome}. Vincitore ufficiale: ${vincitore.nome} (${vincitore.squadra}). Top 10: ${top10}. Stile: ${stile.prompt}. NON citare dati tecnici se non forniti.`,
            schema: z.object({ titolo: z.string(), excerpt: z.string(), contenuto: z.string(), slug: z.string(), tags: z.array(z.string()) }),
          })).object;
        });

        const articoloEN = await step.run(`gen-en-${gara.nome}`, async () => {
          return (await generateObject({
            model: google("gemini-1.5-flash"),
            prompt: `Translate the whole article to professional English cycling journalism: ${articoloIT.titolo} - ${articoloIT.contenuto}`,
            schema: z.object({ titolo: z.string(), excerpt: z.string(), contenuto: z.string() }),
          })).object;
        });

        const pubblicazione = await step.run(`pubblica-${gara.nome}`, async () => {
          const res = await axios.post(`${RC_BASE}/api/admin/articles`, {
            slug: articoloIT.slug, title: articoloIT.titolo, excerpt: articoloIT.excerpt, content: articoloIT.contenuto,
            titleEn: articoloEN.titolo, excerptEn: articoloEN.excerpt, contentEn: articoloEN.contenuto,
            author: "AI Agent", publishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), hashtags: articoloIT.tags, published: false
          }, { headers: { Cookie: sessionCookie } });
          return { id: res.data?.id || res.data?._id };
        });

        garaReport.azioni.push(`Articolo: ${pubblicazione.id}`);
      } catch (err: any) { garaReport.azioni.push(`Errore: ${err.message}`); }
      report.push(garaReport);
    }
    return { success: true, report };
  }
);
