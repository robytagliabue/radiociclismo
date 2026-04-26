import { inngest } from "./inngest.js";
import { google } from "@ai-sdk/google";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import axios from "axios";
import FormData from "form-data";

// ─── COSTANTI ─────────────────────────────────────────────────────────────────
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

const VARIAZIONI_VOCAB: Record<string, string[]> = {
  fuga: ["attacco", "allungo", "iniziativa", "sortita"],
  traguardo: ["arrivo", "linea finale"],
  gruppo: ["plotone", "gruppo compatto", "drappello"],
  "attacco decisivo": ["accelerazione finale", "affondo risolutivo"],
  "ritmo alto": ["andatura sostenuta", "cadenza elevata"],
};

// ─── HELPER: Sessione RC ───────────────────────────────────────────────────────
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

// ─── HELPER: Scraping con headers anti-Cloudflare ────────────────────────────
async function fetchPage(url: string): Promise<string> {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        "Referer": PCS_BASE,
      },
      timeout: 20000,
    });
    return res.data as string;
  } catch (e: any) {
    return `ERRORE: ${e.message}`;
  }
}

// ─── HELPER: Fuzzy match gara RC ─────────────────────────────────────────────
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

// ─── HELPER: Genera CSV risultati ────────────────────────────────────────────
function generaCSV(risultati: any[]): Buffer {
  const header = "POSIZIONE,NOME,SQUADRA,TEMPO,DISTACCO,NAZIONE\n";
  const rows = risultati.map(r =>
    `${r.posizione},"${r.nome}","${r.squadra}","${r.tempo ?? ""}","${r.distacco ?? ""}","${r.nazione ?? "IT"}"`
  ).join("\n");
  return Buffer.from(header + rows, "utf-8");
}

// ─── WORKFLOW PRINCIPALE ──────────────────────────────────────────────────────
export const cyclingWorkflowFn = inngest.createFunction(
  {
    id: "cycling-workflow",
    name: "RadioCiclismo — Genera Articoli e Risultati",
    concurrency: { limit: 1 },
  },
  { event: "cycling/generate.article" },

  async ({ event, step }) => {
    const report: any[] = [];

    // ── STEP 1: Login RC ────────────────────────────────────────────────────
    const sessionCookie = await step.run("login-rc", async () => {
      const cookie = await getSessionCookie();
      if (!cookie) throw new Error("Login RC fallito");
      return cookie;
    });

    // ── STEP 2: Scarica gare RC esistenti ───────────────────────────────────
    const rcGare = await step.run("fetch-rc-races", async () => {
      const res = await axios.get(`${RC_BASE}/api/admin/races?status=approved`, {
        headers: { Cookie: sessionCookie },
      });
      return res.data as any[];
    });

    // ── STEP 3: Scraping gare del giorno da PCS ─────────────────────────────
    const gareOggi = await step.run("scraping-pcs-gare", async () => {
      const html = await fetchPage(`${PCS_BASE}/races.php?date=today`);
      if (html.startsWith("ERRORE")) throw new Error(html);

      const result = await generateObject({
        model: google("gemini-1.5-flash"),
        prompt: `Analizza questo HTML di ProCyclingStats e trova tutte le gare FINITE oggi (status "finished" o "result").
Per ogni gara estrai: nome, url relativo (es /race/giro-d-italia/2026/stage-5), categoria, genere (men/women), tipo (singola/tappa).
HTML: ${html.substring(0, 10000)}`,
        schema: z.object({
          gare: z.array(z.object({
            nome: z.string(),
            urlRelativo: z.string(),
            categoria: z.string(),
            genere: z.enum(["men", "women"]),
            tipo: z.enum(["singola", "tappa"]),
          }))
        }),
      });
      return result.object.gare;
    });

    if (gareOggi.length === 0) {
      return { success: true, message: "Nessuna gara finita oggi su PCS", report };
    }

    // ── STEP 4: Processa ogni gara ──────────────────────────────────────────
    for (const gara of gareOggi) {
      const garaReport: any = { nome: gara.nome, azioni: [] };

      try {
        // 4a. Verifica articolo già esistente
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

        // 4b. Scraping risultati da PCS
        const risultatiPCS = await step.run(`scraping-risultati-${gara.nome}`, async () => {
          const url = `${PCS_BASE}${gara.urlRelativo}`;
          const html = await fetchPage(url);
          if (html.startsWith("ERRORE")) return null;

          const result = await generateObject({
            model: google("gemini-1.5-flash"),
            prompt: `Estrai i risultati da questo HTML di ProCyclingStats per la gara "${gara.nome}".
Estrai top 10 classifica arrivo. Se è una tappa estrai anche classifica generale (top 5).
Non inventare nulla. HTML: ${html.substring(0, 10000)}`,
            schema: z.object({
              classificaArrivo: z.array(z.object({
                posizione: z.number(),
                nome: z.string(),
                squadra: z.string(),
                tempo: z.string().optional(),
                distacco: z.string().optional(),
                nazione: z.string().optional(),
              })),
              classificaGenerale: z.array(z.object({
                posizione: z.number(),
                nome: z.string(),
                squadra: z.string(),
                distacco: z.string().optional(),
              })).optional(),
              percorso: z.string().optional(),
              distanzaKm: z.number().optional(),
              dislivelloM: z.number().optional(),
            }),
          });
          return result.object;
        });

        if (!risultatiPCS) {
          garaReport.azioni.push("Scraping PCS fallito — skippata");
          report.push(garaReport);
          continue;
        }

        // 4c. Cerca notizie su fonti esterne
        const fontiEsterne = await step.run(`fonti-esterne-${gara.nome}`, async () => {
          const fonti = [
            `https://www.cyclingnews.com/search/?q=${encodeURIComponent(gara.nome)}`,
            `https://firstcycling.com/search.php?s=${encodeURIComponent(gara.nome)}`,
          ];
          const testi: string[] = [];
          for (const url of fonti) {
            const html = await fetchPage(url);
            if (!html.startsWith("ERRORE")) {
              testi.push(html.substring(0, 2000));
            }
          }
          return testi.join("\n---\n");
        });

        const haNotizie = fontiEsterne.length > 100;

        // 4d. Seleziona stile e struttura random
        const stile = STILI[Math.floor(Math.random() * STILI.length)];
        const struttura = STRUTTURE[Math.floor(Math.random() * STRUTTURE.length)];

        if (haNotizie) {
          // 4e. Genera articolo IT
          const articoloIT = await step.run(`genera-it-${gara.nome}`, async () => {
            const top10 = risultatiPCS.classificaArrivo
              .slice(0, 10)
              .map(r => `${r.posizione}. ${r.nome} (${r.squadra}) ${r.distacco ?? ""}`)
              .join("\n");

            const classGen = risultatiPCS.classificaGenerale
              ? "\nClassifica Generale:\n" + risultatiPCS.classificaGenerale
                  .slice(0, 5)
                  .map(r => `${r.posizione}. ${r.nome} (${r.squadra}) ${r.distacco ?? ""}`)
                  .join("\n")
              : "";

            const result = await generateObject({
              model: google("gemini-1.5-flash"),
              prompt: `Sei un Redattore Sportivo Senior specializzato in ciclismo per RadioCiclismo.com.

REGOLA D'ORO: NON inventare dati, distacchi, nomi o dichiarazioni. Se un dato non esiste scrivi "informazione non disponibile".
DIVIETO ASSOLUTO di inventare tempi, distacchi, eventi o dichiarazioni.

STILE DA USARE: ${stile.prompt}
STRUTTURA: ${struttura}

DATI REALI DELLA GARA:
Nome: ${gara.nome}
Categoria: ${gara.categoria}
Genere: ${gara.genere === "women" ? "Donne" : "Uomini"}
Tipo: ${gara.tipo}
${risultatiPCS.percorso ? `Percorso: ${risultatiPCS.percorso}` : ""}
${risultatiPCS.distanzaKm ? `Distanza: ${risultatiPCS.distanzaKm}km` : ""}
${risultatiPCS.dislivelloM ? `Dislivello: ${risultatiPCS.dislivelloM}m` : ""}

Top 10:
${top10}
${classGen}

Fonti esterne (usa solo fatti verificati):
${fontiEsterne.substring(0, 2000)}

OUTPUT OBBLIGATORIO:
- Titolo (max efficacia, 0% clickbait)
- Corpo articolo (250-400 parole, stile scelto)
- Il Dettaglio Extra (paragrafo originale: ruolo gregario, impatto economico, ecc.)
- Meta description (max 140 caratteri)
- Slug SEO (es. "giro-italia-2026-tappa-5-risultati")
- Tags (3 tag: es. #WorldTour #Ciclismo #AnalisiTattica)
- 5 titoli SEO alternativi
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
                titoliAlternativi: z.array(z.string()),
                versioneSocial: z.string(),
                versioneInstagram: z.string(),
                bulletPoints: z.array(z.string()),
              }),
            });
            return result.object;
          });

          // 4f. Genera articolo EN
          const articoloEN = await step.run(`genera-en-${gara.nome}`, async () => {
            const result = await generateObject({
              model: google("gemini-1.5-flash"),
              prompt: `You are a senior cycling journalist for RadioCiclismo.com.
Translate and adapt this Italian article to professional English journalism.
Style: ${stile.id}

Italian title: ${articoloIT.titolo}
Italian content: ${articoloIT.contenuto}
Italian excerpt: ${articoloIT.excerpt}
Detail Extra: ${articoloIT.dettaglioExtra}

DO NOT invent anything. Keep all facts identical.`,
              schema: z.object({
                titolo: z.string(),
                excerpt: z.string(),
                contenuto: z.string(),
              }),
            });
            return result.object;
          });

          // 4g. Pubblica articolo in bozza su RC
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
          garaReport.azioni.push(`Stile: ${stile.id} | Struttura: ${struttura.split("—")[0].trim()}`);
        } else {
          garaReport.azioni.push("Nessuna fonte esterna trovata — solo risultati caricati");
        }

        // 4h. Fuzzy match con gare RC
        const garaRC = await step.run(`match-gara-${gara.nome}`, async () => {
          return fuzzyMatch(gara.nome, rcGare, gara.genere);
        });

        if (garaRC) {
          // 4i. Upload risultati come CSV
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
          garaReport.azioni.push(`Risultati caricati su gara RC: "${garaRC.title}" (ID: ${garaRC.id})`);
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
