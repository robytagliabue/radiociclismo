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
  { id: "TECH_GURU", prompt: "Stile IL TECH-GURU — Focus su performance e dinamica atletica." }
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

function parseGareFromPCS(html: string): Array<{ nome: string; url: string; genere: string }> {
  const $ = cheerio.load(html);
  const gare: Array<{ nome: string; url: string; genere: string }> = [];
  const blacklist = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "stage", "prologue"];

  $("table.basic tbody tr").each((i, el) => {
    const linkGara = $(el).find("a[href^='race/']").first();
    const nomeRaw = linkGara.text().trim();
    const urlGara = linkGara.attr("href") || "";
    
    // VERIFICA SE LA GARA È FINITA:
    // Su PCS, se la gara è in corso, la cella del vincitore spesso contiene "Live" o l'orario.
    // Se è finita, contiene il nome del corridore (senza ":" dell'orario).
    const statusCell = $(el).find("td.hide.cs500").next().next().text().trim();
    const isLive = $(el).find(".live, .running").length > 0 || statusCell.toLowerCase().includes("live");
    const hasTime = statusCell.includes(":"); // Se c'è ":" è un orario di partenza/arrivo previsto

    if (!urlGara || isLive || hasTime || statusCell.length < 3) return;
    if (blacklist.some(word => statusCell.toLowerCase().includes(word))) return;

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

    const gareOggi = await step.run("scraping-gare", async () => {
        const html = await fetchPage(`${PCS_BASE}/races.php?date=${new Date().toISOString().split("T")[0]}`);
        return parseGareFromPCS(html);
    });

    if (gareOggi.length === 0) return { success: true, msg: "Nessuna gara terminata trovata" };

    for (const gara of gareOggi) {
      const garaReport: any = { nome: gara.nome, azioni: [] };
      try {
        const esiste = await step.run(`check-${gara.nome}`, async () => {
          const res = await axios.get(`${RC_BASE}/api/admin/articles?search=${encodeURIComponent(gara.nome.substring(0, 20))}`, { headers: { Cookie: sessionCookie } });
          return (res.data?.articles ?? res.data ?? []).some((a: any) => a.title?.toLowerCase().includes(gara.nome.toLowerCase().substring(0, 15)));
        });
        if (esiste) continue;

        const risultati = await step.run(`results-${gara.nome}`, async () => {
          const html = await fetchPage(`${PCS_BASE}${gara.url}`);
          const $ = cheerio.load(html);
          
          // SECONDO CONTROLLO DI SICUREZZA:
          // Se nella pagina della gara troviamo il widget "Live stats" o "Race center", la saltiamo.
          if ($(".live-stats, .race-center, .is-live").length > 0) return null;

          const classifica: any[] = [];
          const blacklistNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "stage", "day", "result"];
          
          // Cerchiamo la tabella specifica dei risultati (solitamente ha classe .results)
          $("table.results tbody tr").each((i, el) => {
            const nome = $(el).find("td:nth-child(2)").text().trim();
            const tempo = $(el).find("td:nth-child(4)").text().trim();
            
            // Un risultato reale deve avere un nome e spesso un tempo/distacco
            if (nome && nome.length > 3 && !blacklistNames.some(w => nome.toLowerCase().includes(w)) && !/^\d/.test(nome)) {
              if (classifica.length < 20) {
                classifica.push({ 
                    posizione: classifica.length + 1, 
                    nome, 
                    squadra: $(el).find("td:nth-child(3)").text().trim(), 
                    tempo 
                });
              }
            }
          });

          // Se abbiamo meno di 10 corridori, è probabile che la classifica sia ancora parziale/live
          return classifica.length >= 10 ? { classifica } : null;
        });

        if (!risultati) continue;

        const stile = STILI[articoliGenerati % STILI.length];
        articoliGenerati++;

        const articoloIT = await step.run(`gen-it-${gara.nome}`, async () => {
          const vincitore = risultati.classifica[0];
          const top10 = risultati.classifica.slice(0, 10).map(r => `${r.posizione}. ${r.nome} (${r.squadra})`).join(", ");
          return (await generateObject({
            model: google("gemini-1.5-flash"),
            prompt: `Sei un giornalista sportivo. Scrivi un articolo professionale sulla gara terminata: ${gara.nome}. Vincitore ufficiale: ${vincitore.nome}. Top 10: ${top10}. Stile: ${stile.prompt}. Traduci i nomi delle squadre se necessario, ma mantieni i nomi dei corridori originali. NON citare dati tecnici se non forniti.`,
            schema: z.object({ titolo: z.string(), excerpt: z.string(), contenuto: z.string(), slug: z.string(), tags: z.array(z.string()) }),
          })).object;
        });

        const articoloEN = await step.run(`gen-en-${gara.nome}`, async () => {
          return (await generateObject({
            model: google("gemini-1.5-flash"),
            prompt: `Translate this article to English. Professional cycling journalism style. Translate the WHOLE content: ${articoloIT.titolo} - ${articoloIT.contenuto}`,
            schema: z.object({ titolo: z.string(), excerpt: z.string(), contenuto: z.string() }),
          })).object;
        });

        const pubblicazione = await step.run(`pubblica-${gara.nome}`, async () => {
          const body = {
            slug: articoloIT.slug, title: articoloIT.titolo, excerpt: articoloIT.excerpt, content: articoloIT.contenuto,
            titleEn: articoloEN.titolo, excerptEn: articoloEN.excerpt, contentEn: articoloEN.contenuto,
            author: "AI Agent", publishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), hashtags: articoloIT.tags, published: false
          };
          const res = await axios.post(`${RC_BASE}/api/admin/articles`, body, { headers: { Cookie: sessionCookie } });
          return { id: res.data?.id || res.data?._id };
        });

        garaReport.azioni.push(`Articolo Creato: ${pubblicazione.id}`);
      } catch (err: any) { garaReport.azioni.push(`Errore: ${err.message}`); }
      report.push(garaReport);
    }
    return { success: true, report };
  }
);
