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
    id: "EPICO_NARRATORE",
    prompt: `Stile L'EPICO NARRATORE — Focus: resilienza e percorso dell'atleta.
Usa esclusivamente i dati reali presenti nel contesto (classifica, squadra, gara odierna).
Se il corridore non vince da N giorni e il dato è fornito, citalo con il numero esatto.
Se è un neoprofessionista, sottolinea la "prima volta" senza aggiungere dettagli inventati.
VIETATO inventare biografie, infortuni passati, origini familiari o dichiarazioni non verificabili.
Tono narrativo, empatico, ritmo letterario.
CLAUSOLA DI SICUREZZA: se non hai dati storici sul corridore, passa automaticamente allo stile CRONISTA FLASH.`
  },
  {
    id: "SPECIALISTA_TECNICO",
    prompt: `Stile LO SPECIALISTA TECNICO — Focus: il "come" si è vinta la gara.
Analizza i momenti chiave della gara: quando è scattato l'attacco, come si è formata la selezione, gestione del ritmo in salita.
Usa verbi tecnici: scollinare, rilanciare, fare il buco, andare in fuga, gestire il ventaglio.
Basati SOLO sui dati di classifica e percorso forniti. Non inventare pendenze o tempi di scalata se non presenti.
Tono autorevole e tecnico. Zero aggettivi vuoti.`
  },
  {
    id: "FLASH_NEWS",
    prompt: `Stile IL CRONISTA FLASH — Focus: immediatezza e fatti nudi.
Inizia con il fatto principale: chi ha vinto, gara, anno.
Poi classifica Top 10 sintetica con distacchi se disponibili.
Poi classifica generale aggiornata se disponibile.
Zero commenti, zero speculazioni, zero dettagli non forniti.
Frasi brevi. Perfetto per social e lettura rapida.`
  },
  {
    id: "TECH_GURU",
    prompt: `Stile IL TECH-GURU — Focus: materiali e performance atletica.
Cita solo brand di bici e componenti effettivamente usati dal team vincitore se presenti nei dati.
Se disponibili dati su distacchi, tempi o record storici, usali per fare confronti concreti.
CLAUSOLA DI SICUREZZA: se non hai dati tecnici su bici o wattaggio, passa automaticamente allo stile SPECIALISTA TECNICO limitandoti alla dinamica della gara odierna.
Tono scientifico, curioso, specialistico.`
  },
  {
    id: "SPECIALISTA_TECNICO_2",
    prompt: `Stile LO SPECIALISTA TECNICO (variante) — Focus: tattica di squadra e dinamiche di gara.
Analizza come la squadra vincitrice ha controllato la corsa, chi ha fatto il lavoro di squadra, come si è sviluppato lo sprint o l'attacco decisivo.
Basati esclusivamente sui dati forniti (classifica, squadre, distacchi).
Tono autorevole. Verbi tecnici del ciclismo. Nessun dettaglio inventato.`
  },
];

const STRUTTURE = [
  `Struttura: 1.Apertura con il fatto principale (vincitore + gara) 2.Top 10 commentato 3.Analisi nello stile scelto 4.Conclusione`,
];

let articoliGenerati = 0;

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

  $("table tr").each((i, el) => {
    const $el = $(el);
    const link = $el.find("a[href^='race/']").first();
    let nome = link.text().trim();
    let url = link.attr("href") || "";

    if (!nome || !url || urlsSeen.has(url)) return;
    if (!url.startsWith("/")) url = "/" + url;

    const dataCell = $el.find("td.cs500, td[class*='cs500']").first().text().trim();
    const oggi = new Date();
    const oggiStr = `${String(oggi.getDate()).padStart(2, "0")}.${String(oggi.getMonth() + 1).padStart(2, "0")}`;
    
    const isOggi = !dataCell || dataCell.includes(oggiStr);
    if (!isOggi) return;

    urlsSeen.add(url);
    const genere = nome.toLowerCase().includes("women") || nome.toLowerCase().includes("femm") ? "women" : "men";
    gare.push({ nome, url, genere, stato: "finished" });
  });

  return gare;
}

function normalizzaNome(nome: string): string {
  return nome.toLowerCase().replace(/\d{4}/g, "").replace(/stage\s*\d+/gi, "").replace(/[^a-z\s]/g, "").trim();
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
  const rows = risultati.map(r => `${r.posizione},"${r.nome}","${r.squadra}","${r.tempo ?? ""}","${r.distacco ?? ""}","${r.nazione ?? "IT"}"`).join("\n");
  return Buffer.from(header + rows, "utf-8");
}

export const cyclingWorkflowFn = inngest.createFunction(
  { id: "cycling-workflow", name: "RadioCiclismo — Genera Articoli e Risultati", concurrency: { limit: 1 } },
  { event: "cycling/generate.article" },
  async ({ event, step }) => {
    const report: any[] = [];

    const sessionCookie = await step.run("login-rc", async () => {
      const cookie = await getSessionCookie();
      if (!cookie) throw new Error("Login RC fallito");
      return cookie;
    });

    const rcGare = await step.run("fetch-rc-races", async () => {
      const res = await axios.get(`${RC_BASE}/api/admin/races?status=approved`, { headers: { Cookie: sessionCookie } });
      return res.data as any[];
    });

    const gareOggi = await step.run("scraping-pcs-gare", async () => {
      const oggi = new Date().toISOString().split("T")[0];
      const html = await fetchPage(`${PCS_BASE}/races.php?date=${oggi}&circuit=&class=&filter=Filter`);
      if (html.startsWith("ERRORE")) throw new Error(html);
      return parseGareFromPCS(html);
    });

    if (gareOggi.length === 0) return { success: true, message: "Nessuna gara oggi", report };

    for (const gara of gareOggi) {
      const garaReport: any = { nome: gara.nome, azioni: [] };
      try {
        const articoloEsiste = await step.run(`check-articolo-${gara.nome}`, async () => {
          try {
            const res = await axios.get(`${RC_BASE}/api/admin/articles?search=${encodeURIComponent(gara.nome.substring(0, 30))}&limit=10`, { headers: { Cookie: sessionCookie } });
            const articles = res.data?.articles ?? res.data ?? [];
            return articles.some((a: any) => a.title?.toLowerCase().includes(gara.nome.toLowerCase().substring(0, 20)));
          } catch { return false; }
        });

        if (articoloEsiste) {
          garaReport.azioni.push("Articolo già presente");
          report.push(garaReport);
          continue;
        }

        const risultatiPCS = await step.run(`scraping-risultati-${gara.nome}`, async () => {
          const html = await fetchPage(`${PCS_BASE}${gara.url}`);
          if (html.startsWith("ERRORE")) return null;
          const $ = cheerio.load(html);
          const classificaArrivo: any[] = [];
          $("table tbody tr, div.result-row").each((i, el) => {
            const $el = $(el);
            const nome = $el.find("td:nth-child(2), .rider-name").text().trim();
            if (nome) classificaArrivo.push({ posizione: i + 1, nome, squadra: $el.find("td:nth-child(3), .team-name").text().trim(), tempo: $el.find("td:nth-child(4), .time").text().trim(), distacco: "" });
          });
          return { classificaArrivo };
        });

        if (!risultatiPCS) continue;

        const stile = STILI[articoliGenerati % STILI.length];
        articoliGenerati++;

        if (risultatiPCS.classificaArrivo.length > 0) {
          const articoloIT = await step.run(`genera-it-${gara.nome}`, async () => {
            const vincitore = risultatiPCS.classificaArrivo[0];
            const top10 = risultatiPCS.classificaArrivo.slice(0, 10).map(r => `${r.posizione}. ${r.nome} (${r.squadra})`).join("\n");
            const result = await generateObject({
              model: google("gemini-2.5-flash-lite"),
              prompt: `Redattore RadioCiclismo. Gara: ${gara.nome}. Vincitore: ${vincitore.nome}. Top 10: ${top10}. Stile: ${stile.prompt}. Struttura: ${STRUTTURE[0]}`,
              schema: z.object({ titolo: z.string(), excerpt: z.string(), contenuto: z.string(), dettaglioExtra: z.string(), slug: z.string(), tags: z.array(z.string()) }),
            });
            return result.object;
          });

          const articoloEN = await step.run(`genera-en-${gara.nome}`, async () => {
            const result = await generateObject({
              model: google("gemini-2.5-flash-lite"),
              prompt: `Translate to English: ${articoloIT.titolo} - ${articoloIT.contenuto}`,
              schema: z.object({ titolo: z.string(), excerpt: z.string(), contenuto: z.string() }),
            });
            return result.object;
          });

          const pubblicazione = await step.run(`pubblica-${gara.nome}`, async () => {
            const body = {
              slug: articoloIT.slug,
              title: articoloIT.titolo,
              excerpt: articoloIT.excerpt,
              content: `${articoloIT.contenuto}\n\n${articoloIT.dettaglioExtra}`,
              titleEn: articoloEN.titolo,
              excerptEn: articoloEN.excerpt,
              contentEn: articoloEN.contenuto,
              author: "AI Agent",
              publishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              images: [],
              hashtags: articoloIT.tags,
              published: false,
            };
            const res = await axios.post(`${RC_BASE}/api/admin/articles`, body, { headers: { "Content-Type": "application/json", Cookie: sessionCookie } });
            return { id: res.data?.id || res.data?._id };
          });

          garaReport.azioni.push(`Articolo ID: ${pubblicazione.id}`);
        }

        const garaRC = await step.run(`match-gara-${gara.nome}`, async () => fuzzyMatch(gara.nome, rcGare, gara.genere));

        if (garaRC) {
          await step.run(`upload-risultati-${gara.nome}`, async () => {
            const form = new FormData();
            form.append("file", generaCSV(risultatiPCS.classificaArrivo), { filename: `risultati-${garaRC.slug}.csv`, contentType: "text/csv" });
            await axios.post(`${RC_BASE}/api/admin/races/${garaRC.id}/import-results`, form, { headers: { ...form.getHeaders(), Cookie: sessionCookie } });
            return { success: true };
          });
          garaReport.azioni.push(`Risultati caricati`);
        }
      } catch (err: any) {
        garaReport.azioni.push(`ERRORE: ${err.message}`);
      }
      report.push(garaReport);
    }
    return { success: true, report };
  }
);
