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
  {
    id: "ANALISI_TATTICA",
    prompt: `[ANALISI TATTICA] Focus su dinamiche di gara, pendenze, rapporti di forza e strategia delle ammiraglie. Tono autorevole e tecnico. Usa verbi specifici del ciclismo: scattare, fare il buco, scollinare, rilanciare. Evita aggettivi generici come "fantastico" o "incredibile".`
  },
  {
    id: "LATO_UMANO",
    prompt: `[LATO UMANO] Focus sulla resilienza, la fatica, la gestione del fallimento e la rinascita identitaria dell'atleta. Tono narrativo ed empatico. Costruisci una piccola storia, dai contesto, usa un ritmo più letterario.`
  },
  {
    id: "BUSINESS_MANAGEMENT",
    prompt: `[BUSINESS & MANAGEMENT] Focus su sponsor, valore del brand, logistica dei team e transizione di carriera degli atleti. Tono asciutto e professionale. Stile giornalistico classico: pulito, informativo, equilibrato.`
  },
  {
    id: "FLASH_NEWS",
    prompt: `[FLASH NEWS] Formato rapido. Frasi brevi, informative, dirette. Focus su: Cosa è successo, Chi è coinvolto, Classifica aggiornata. Stile minimal & rapido.`
  },
  {
    id: "TECH_INSIDER",
    prompt: `[TECH & INSIDER] Focus su materiali, aerodinamica, alimentazione e dietro le quinte della carovana. Tono curioso e specialistico. Valorizza statistiche, record, confronti storici.`
  },
];

const STRUTTURE = [
  `Struttura 1 — Classica: 1.Introduzione 2.Percorso 3.Favoriti 4.Cronaca 5.Top10 6.Classifiche 7.Analisi finale`,
  `Struttura 2 — Cronaca prima: 1.Cronaca subito 2.Contesto gara 3.Percorso 4.Favoriti 5.Top10 6.Analisi tecnica`,
  `Struttura 3 — Analisi prima: 1.Analisi tattica iniziale 2.Cronaca sintetica 3.Percorso 4.Top10 5.Prossime gare`,
];

async function getSessionCookie(): Promise<string> {
  try {
    const res = await axios.post(
      `${RC_BASE}/api/admin/login`,
      { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD },
      { headers: { "Content-Type": "application/json" }, maxRedirects: 0, validateStatus: s => s < 400 }
    );
    const cookies = res.headers["set-cookie"] || [];
    for (const c of cookies) {
      if (c.includes("connect.sid")) return c.split(";")[0];
    }
    return cookies[0]?.split(";")[0] ?? "";
  } catch { return ""; }
}

async function fetchPage(url: string): Promise<string> {
  try {
    const result = execSync(
      `curl -4 -s -L --http2 --max-time 30 \
      -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36" \
      -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8" \
      -H "Accept-Language: it-IT,it;q=0.9,en;q=0.8" \
      -H "Accept-Encoding: gzip, deflate, br" \
      -H "Cache-Control: no-cache" \
      -H "Referer: https://www.procyclingstats.com/" \
      -H "sec-ch-ua: \\"Google Chrome\\";v=\\"135\\", \\"Not-A.Brand\\";v=\\"8\\", \\"Chromium\\";v=\\"135\\"" \
      -H "sec-ch-ua-mobile: ?0" \
      -H "sec-ch-ua-platform: \\"macOS\\"" \
      -H "Sec-Fetch-Dest: document" \
      -H "Sec-Fetch-Mode: navigate" \
      -H "Sec-Fetch-Site: none" \
      -H "Sec-Fetch-User: ?1" \
      -H "Upgrade-Insecure-Requests: 1" \
      --compressed \
      "${url}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    return result.toString();
  } catch (e: any) {
    return `ERRORE: ${e.message}`;
  }
}

function parseGareFromPCS(html: string): Array<{ nome: string; url: string; genere: string; stato: string }> {
  const $ = cheerio.load(html);
  const gare: Array<{ nome: string; url: string; genere: string; stato: string }> = [];
  const urlsSeen = new Set<string>();

  // DEBUG: logga tutti i tag <table> trovati per capire la struttura reale
  console.log("[PCS PARSE] Numero tabelle trovate:", $("table").length);
  $("table").each((i, el) => {
    console.log(`[PCS PARSE] Tabella ${i} — class: "${$(el).attr("class")}" — righe: ${$(el).find("tr").length}`);
  });

  // Prova selettori multipli in cascata — il primo che funziona vince
  const SELETTORI = [
    "table.races-todo tr",
    "table.races-finished tr",
    ".hp-race-item",
    "ul.raceListTile li",        // struttura alternativa PCS
    "div.race-item",
    "table tr",                   // fallback generico
  ];

  let elementiTrovati = 0;

  for (const sel of SELETTORI) {
    const trovati = $(sel).length;
    console.log(`[PCS PARSE] Selettore "${sel}" — trovati: ${trovati}`);
    if (trovati > 0) elementiTrovati += trovati;
  }

  // Usa il selettore più generico se quelli specifici falliscono
  $("table.races-todo tr, table.races-finished tr, .hp-race-item, ul.raceListTile li").each((i, el) => {
    const $el = $(el);

    // Cerca link che inizia con race/ o /race/
    const link = $el.find("a[href*='race/']").first();

    let nome = link.text().trim();
    let url = link.attr("href") || "";

    // Normalizza URL: assicurati che inizi con /
    if (url && !url.startsWith("/")) url = "/" + url;

    if (!nome || !url || urlsSeen.has(url)) return;

    const testoRiga = $el.text().toLowerCase();

    const isFinished =
      testoRiga.includes("finished") ||
      testoRiga.includes("result") ||
      testoRiga.includes("prologue") ||
      testoRiga.includes("stage");

    if (isFinished) {
      urlsSeen.add(url);
      const genere = nome.toLowerCase().includes("women") || nome.toLowerCase().includes("femm") ? "women" : "men";
      gare.push({ nome, url, genere, stato: "finished" });
      console.log(`[PCS PARSE] ✅ Gara trovata: "${nome}" → ${url}`);
    }
  });

  return gare;
}

function normalizzaNome(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/\d{4}/g, "")
    .replace(/stage\s*\d+/gi, "")
    .replace(/tappa\s*\d+/gi, "")
    .replace(/results?/gi, "")
    .replace(/classifica generale/gi, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function fuzzyMatch(pcsNome: string, rcGare: any[], genere: string): any | null {
  const pcsNorm = normalizzaNome(pcsNome);
  const pcsParole = pcsNorm.split(/\s+/).filter(p => p.length >= 3);

  let miglior: any = null;
  let migliorScore = 0;

  for (const gara of rcGare) {
    if (genere === "women" && gara.gender !== "women") continue;
    if (genere === "men" && gara.gender === "women") continue;

    const rcNorm = normalizzaNome(gara.title);
    const match = pcsParole.filter(p => rcNorm.includes(p)).length;
    const score = pcsParole.length > 0 ? match / pcsParole.length : 0;

    if (score >= 0.7 && score > migliorScore) {
      migliorScore = score;
      miglior = gara;
    }
  }
  return miglior;
}

function generaCSV(risultati: any[]): Buffer {
  const header = "POSIZIONE,NOME,SQUADRA,TEMPO,DISTACCO,NAZIONE\n";
  const rows = risultati.map(r =>
    `${r.posizione},"${r.nome}","${r.squadra}","${r.tempo ?? ""}","${r.distacco ?? ""}","${r.nazione ?? "IT"}"`
  ).join("\n");
  return Buffer.from(header + rows, "utf-8");
}

export const cyclingWorkflowFn = inngest.createFunction(
  {
    id: "cycling-workflow",
    name: "RadioCiclismo — Genera Articoli e Risultati",
    concurrency: { limit: 1 },
  },
  { event: "cycling/generate.article" },

  async ({ event, step }) => {
    const report: any[] = [];

    const sessionCookie = await step.run("login-rc", async () => {
      const cookie = await getSessionCookie();
      if (!cookie) throw new Error("Login RC fallito");
      return cookie;
    });

    const rcGare = await step.run("fetch-rc-races", async () => {
      const res = await axios.get(`${RC_BASE}/api/admin/races?status=approved`, {
        headers: { Cookie: sessionCookie },
      });
      return res.data as any[];
    });

    const gareOggi = await step.run("scraping-pcs-gare", async () => {
      const oggi = new Date().toISOString().split("T")[0]; // "2026-04-28"
      const html = await fetchPage(`${PCS_BASE}/races.php?date=${oggi}&circuit=&class=&filter=Filter`);
      if (html.startsWith("ERRORE")) throw new Error(html);

      console.log("[PCS] Lunghezza HTML:", html.length);
      console.log("[PCS] È Cloudflare:", html.includes("Just a moment"));

      // Stampa HTML dal carattere 4000 in poi dove sono le gare del giorno
      for (let i = 4000; i < Math.min(html.length, 10000); i += 500) {
        console.log(`[PCS HTML ${i}-${i+500}]:`, html.substring(i, i + 500));
      }

      // Tutti i link race/ con contesto (50 char prima e dopo)
      const allMatches = [...html.matchAll(/href="([^"]*race\/[^"]*)"/g)];
      console.log("[PCS] Totale link race/:", allMatches.length);
      allMatches.forEach((m, idx) => {
        const pos = m.index || 0;
        console.log(`[PCS] Link ${idx}:`, m[1], "| contesto:", html.substring(pos - 80, pos + 80));
      });

      throw new Error("DEBUG STOP — controlla i log sopra");
    });

    if (gareOggi.length === 0) {
      return { success: true, message: "Nessuna gara finita oggi su PCS", report };
    }

    for (const gara of gareOggi) {
      const garaReport: any = { nome: gara.nome, azioni: [] };

      try {
        const articoloEsiste = await step.run(`check-articolo-${gara.nome}`, async () => {
          const res = await axios.get(
            `${RC_BASE}/api/admin/articles?search=${encodeURIComponent(gara.nome)}&limit=5`,
            { headers: { Cookie: sessionCookie } }
          );
          const articles = res.data?.articles ?? [];
          return articles.some((a: any) =>
            a.title?.toLowerCase().includes(gara.nome.toLowerCase().substring(0, 15))
          );
        });

        if (articoloEsiste) {
          garaReport.azioni.push("Articolo già presente — skippato");
          report.push(garaReport);
          continue;
        }

        const risultatiPCS = await step.run(`scraping-risultati-${gara.nome}`, async () => {
          const url = `${PCS_BASE}${gara.url}`;
          const html = await fetchPage(url);
          if (html.startsWith("ERRORE")) return null;

          const $ = cheerio.load(html);
          const classificaArrivo: any[] = [];

          $("table tbody tr, div.result-row").each((i, el) => {
            const $el = $(el);
            const posizione = i + 1;
            const nome = $el.find("td:nth-child(2), .rider-name").text().trim();
            const squadra = $el.find("td:nth-child(3), .team-name").text().trim();
            const tempo = $el.find("td:nth-child(4), .time").text().trim();

            if (nome) {
              classificaArrivo.push({ posizione, nome, squadra, tempo, distacco: "" });
            }
          });

          return { classificaArrivo, percorso: "", distanzaKm: 0, dislivelloM: 0 };
        });

        if (!risultatiPCS) {
          garaReport.azioni.push("Scraping PCS fallito — skippata");
          report.push(garaReport);
          continue;
        }

        const fontiEsterne = await step.run(`fonti-esterne-${gara.nome}`, async () => {
          const fonti = [
            `https://www.cyclingnews.com/search/?q=${encodeURIComponent(gara.nome)}`,
            `https://firstcycling.com/search.php?s=${encodeURIComponent(gara.nome)}`,
          ];
          const testi: string[] = [];
          for (const url of fonti) {
            const html = await fetchPage(url);
            if (!html.startsWith("ERRORE")) testi.push(html.substring(0, 2000));
          }
          return testi.join("\n---\n");
        });

        const haNotizie = fontiEsterne.length > 100;
        const stile = STILI[Math.floor(Math.random() * STILI.length)];
        const struttura = STRUTTURE[Math.floor(Math.random() * STRUTTURE.length)];

        if (haNotizie) {
          const articoloIT = await step.run(`genera-it-${gara.nome}`, async () => {
            const top10 = risultatiPCS.classificaArrivo
              .slice(0, 10)
              .map(r => `${r.posizione}. ${r.nome} (${r.squadra}) ${r.distacco ?? ""}`)
              .join("\n");

            const result = await generateObject({
              model: google("gemini-2.0-flash"),
              prompt: `Sei un Redattore Sportivo Senior specializzato in ciclismo per RadioCiclismo.com.

REGOLA D'ORO: NON inventare dati, distacchi, nomi o dichiarazioni. Se un dato non esiste scrivi "informazione non disponibile".

STILE DA USARE: ${stile.prompt}
STRUTTURA: ${struttura}

DATI REALI DELLA GARA:
Nome: ${gara.nome}
Genere: ${gara.genere === "women" ? "Donne" : "Uomini"}

Top 10:
${top10}

Fonti esterne (usa solo fatti verificati):
${fontiEsterne.substring(0, 2000)}

OUTPUT OBBLIGATORIO:
- Titolo (max efficacia, 0% clickbait)
- Corpo articolo (250-400 parole, stile scelto)
- Il Dettaglio Extra (paragrafo originale)
- Meta description (max 140 caratteri)
- Slug SEO
- Tags (3 tag)
- Versione social (max 400 caratteri)
- Versione Instagram (max 150 caratteri)
- 8 bullet points riassuntivi
- Excerpt/anteprima (max 200 caratteri)`,
              schema: z.object({
                titolo: z.string(),
                excerpt: z.string(),
                contenuto: z.string(),
                dettaglioExtra: z.string(),
                metaDescription: z.string(),
                slug: z.string(),
                tags: z.array(z.string()),
                versioneSocial: z.string(),
                versioneInstagram: z.string(),
                bulletPoints: z.array(z.string()),
              }),
            });
            return result.object;
          });

          const articoloEN = await step.run(`genera-en-${gara.nome}`, async () => {
            const result = await generateObject({
              model: google("gemini-2.0-flash"),
              prompt: `You are a senior cycling journalist for RadioCiclismo.com.
Translate and adapt this Italian article to professional English journalism.

Italian title: ${articoloIT.titolo}
Italian content: ${articoloIT.contenuto}

DO NOT invent anything. Keep all facts identical.`,
              schema: z.object({
                titolo: z.string(),
                excerpt: z.string(),
                contenuto: z.string(),
              }),
            });
            return result.object;
          });

          const pubblicazione = await step.run(`pubblica-${gara.nome}`, async () => {
            const res = await axios.post(
              `${RC_BASE}/api/admin/articles`,
              {
                slug: articoloIT.slug,
                title: articoloIT.titolo,
                excerpt: articoloIT.excerpt,
                content: `${articoloIT.contenuto}\n\n${articoloIT.dettaglioExtra}`,
                titleEn: articoloEN.titolo,
                excerptEn: articoloEN.excerpt,
                contentEn: articoloEN.contenuto,
                author: "AI Agent",
                publishAt: new Date().toISOString(),
                images: [],
                hashtags: articoloIT.tags,
                published: false,
              },
              { headers: { "Content-Type": "application/json", Cookie: sessionCookie } }
            );
            return { id: res.data?.id, success: true };
          });

          garaReport.azioni.push(`Articolo creato in bozza — ID: ${pubblicazione.id}`);
          garaReport.azioni.push(`Stile: ${stile.id}`);
        } else {
          garaReport.azioni.push("Nessuna fonte esterna trovata — solo risultati caricati");
        }

        const garaRC = await step.run(`match-gara-${gara.nome}`, async () => {
          return fuzzyMatch(gara.nome, rcGare, gara.genere);
        });

        if (garaRC) {
          await step.run(`upload-risultati-${gara.nome}`, async () => {
            const csvBuffer = generaCSV(risultatiPCS.classificaArrivo);
            const form = new FormData();
            form.append("file", csvBuffer, {
              filename: `risultati-${garaRC.slug}.csv`,
              contentType: "text/csv",
            });
            await axios.post(
              `${RC_BASE}/api/admin/races/${garaRC.id}/import-results`,
              form,
              { headers: { ...form.getHeaders(), Cookie: sessionCookie } }
            );
            return { success: true };
          });
          garaReport.azioni.push(`Risultati caricati su gara RC: "${garaRC.title}"`);
        } else {
          garaReport.azioni.push(`Nessuna gara RC abbinata — risultati NON caricati`);
        }

      } catch (err: any) {
        garaReport.azioni.push(`ERRORE: ${err.message}`);
      }

      report.push(garaReport);
    }

    return { success: true, gaareProcessate: gareOggi.length, report };
  }
);
