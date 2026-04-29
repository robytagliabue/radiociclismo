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

// NOTA: lo stile INSIDER DI SQUADRA (sponsor/management) è riservato ad articoli
// dedicati ai team (presentazioni, cambi sponsor) — NON viene usato per cronache di gara.

// Contatore globale per rotazione stili

const STRUTTURE = [
  `Struttura: 1.Apertura con il fatto principale (vincitore + gara) 2.Top 10 commentato 3.Analisi nello stile scelto 4.Conclusione`,
];

// Contatore globale per rotazione stili
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

  // Struttura reale PCS: righe <tr> con data in <td class="hide cs500"> e link in <a href="race/...">
  $("table tr").each((i, el) => {
    const $el = $(el);

    // Cerca link a gare (href="race/nome/anno")
    const link = $el.find("a[href^='race/']").first();
    let nome = link.text().trim();
    let url = link.attr("href") || "";

    if (!nome || !url || urlsSeen.has(url)) return;

    // Normalizza URL con slash iniziale
    if (!url.startsWith("/")) url = "/" + url;

    // Estrai la data dalla cella con classe cs500
    const dataCell = $el.find("td.cs500, td[class*='cs500']").first().text().trim();

    // Considera solo gare di oggi (data nel formato dd.mm)
    const oggi = new Date();
    const oggiStr = `${String(oggi.getDate()).padStart(2, "0")}.${String(oggi.getMonth() + 1).padStart(2, "0")}`;
    
    // Includi la gara se la data corrisponde a oggi, oppure se non c'è data (per sicurezza)
    const isOggi = !dataCell || dataCell.includes(oggiStr);
    if (!isOggi) return;

    urlsSeen.add(url);
    const genere = nome.toLowerCase().includes("women") || nome.toLowerCase().includes("femm") ? "women" : "men";
    gare.push({ nome, url, genere, stato: "finished" });
    console.log(`[PCS PARSE] ✅ Gara trovata: "${nome}" (data: ${dataCell}) → ${url}`);
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

      const gare = parseGareFromPCS(html);

      if (gare.length === 0) {
        console.log("[PCS] ⚠️ Nessuna gara trovata per oggi. HTML 4000-6000:");
        console.log(html.substring(4000, 6000));
        throw new Error("Nessuna gara trovata su PCS per oggi");
      }

      console.log(`[PCS] ✅ Trovate ${gare.length} gare:`, gare.map(g => g.nome));
      return gare;
    });

    if (gareOggi.length === 0) {
      return { success: true, message: "Nessuna gara finita oggi su PCS", report };
    }

    for (const gara of gareOggi) {
      const garaReport: any = { nome: gara.nome, azioni: [] };

      try {
        const articoloEsiste = await step.run(`check-articolo-${gara.nome}`, async () => {
          try {
            const res = await axios.get(
              `${RC_BASE}/api/admin/articles?search=${encodeURIComponent(gara.nome.substring(0, 30))}&limit=10`,
              { headers: { Cookie: sessionCookie } }
            );
            const articles = res.data?.articles ?? res.data ?? [];
            const exists = articles.some((a: any) =>
              a.title?.toLowerCase().includes(gara.nome.toLowerCase().substring(0, 20))
            );
            console.log(`[CHECK] "${gara.nome}" già pubblicata: ${exists}`);
            return exists;
          } catch {
            return false;
          }
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

          // DEBUG: vediamo la struttura reale della pagina risultati PCS
          console.log("[RISULTATI] URL:", url);
          console.log("[RISULTATI] HTML lunghezza:", html.length);
          console.log("[RISULTATI] Tabelle trovate:", $("table").length);
          $("table").each((i, el) => {
            const cls = $(el).attr("class") || "";
            const righe = $(el).find("tr").length;
            console.log(`[RISULTATI] Tabella ${i} class="${cls}" righe=${righe}`);
            if (righe > 2) {
              // Stampa le prime 2 righe di ogni tabella con più di 2 righe
              $(el).find("tr").slice(0, 2).each((j, tr) => {
                console.log(`[RISULTATI]   Riga ${j}:`, $(tr).text().replace(/\s+/g, " ").trim().substring(0, 150));
              });
            }
          });

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

          console.log("[RISULTATI] Corridori estratti:", classificaArrivo.length);
          if (classificaArrivo.length > 0) {
            console.log("[RISULTATI] Primo:", JSON.stringify(classificaArrivo[0]));
            console.log("[RISULTATI] Secondo:", JSON.stringify(classificaArrivo[1]));
          }

          return { classificaArrivo, percorso: "", distanzaKm: 0, dislivelloM: 0 };
        });

        if (!risultatiPCS) {
          garaReport.azioni.push("Scraping PCS fallito — skippata");
          report.push(garaReport);
          continue;
        }

        // Rotazione stili deterministica (mod 5) — non casuale
        const stile = STILI[articoliGenerati % STILI.length];
        const struttura = STRUTTURE[0];
        articoliGenerati++;

        if (risultatiPCS.classificaArrivo.length > 0) {
          const articoloIT = await step.run(`genera-it-${gara.nome}`, async () => {
            const vincitore = risultatiPCS.classificaArrivo[0];
            const top10 = risultatiPCS.classificaArrivo
              .slice(0, 10)
              .map(r => `${r.posizione}. ${r.nome} (${r.squadra})${r.distacco ? " +" + r.distacco : " [vincitore]"}`)
              .join("\n");

            const result = await generateObject({
              model: google("gemini-2.5-flash-lite"),
              prompt: `Sei un redattore sportivo specializzato in ciclismo per RadioCiclismo.com.

════════════════════════════════
REGOLE ASSOLUTE — NON DEROGABILI
════════════════════════════════
1. USA ESCLUSIVAMENTE i dati forniti qui sotto. Non aggiungere fatti, citazioni, retroscena o dettagli non presenti.
2. Se un dato manca (es. distacco, nazionalità), scrivi "–" o ometti il campo. MAI inventare.
3. Il vincitore è sempre il corridore in POSIZIONE 1 della classifica fornita. Usa il suo nome esatto.
4. Non menzionare fonti esterne, sponsor o dichiarazioni che non compaiono nei dati.
5. FALLBACK AUTOMATICO: se lo stile richiede dati storici o tecnici (EPICO_NARRATORE, TECH_GURU) e questi non sono presenti nella classifica fornita, scrivi l'articolo in stile CRONISTA FLASH. Meglio un articolo corto e vero che uno lungo e inventato.
6. Il titolo DEVE contenere: nome della gara + nome del vincitore (dalla posizione 1). MAI usare placeholder come [VINCITORE].

════════════════════════════════
DATI REALI DELLA GARA
════════════════════════════════
Gara: ${gara.nome}
Anno: ${new Date().getFullYear()}
Categoria: ${gara.genere === "women" ? "Ciclismo Femminile" : "Ciclismo Maschile"}
Vincitore: ${vincitore.nome} (${vincitore.squadra})

Classifica finale Top 10:
${top10}

════════════════════════════════
STILE EDITORIALE DA APPLICARE
════════════════════════════════
${stile.prompt}

════════════════════════════════
STRUTTURA OBBLIGATORIA
════════════════════════════════
${struttura}

Lunghezza corpo articolo: 250-350 parole.
Titolo: sportivo, informativo, senza clickbait. Deve contenere il nome della gara e del vincitore.
Slug SEO: formato kebab-case con nome-gara-vincitore-anno.
Tags: massimo 3, specifici (nome gara, nome vincitore, squadra).`,
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
              model: google("gemini-2.5-flash-lite"),
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
            console.log("[PUBBLICA] Body inviato:", JSON.stringify(body, null, 2));
            try {
              const res = await axios.post(
                `${RC_BASE}/api/admin/articles`,
                body,
                { headers: { "Content-Type": "application/json", Cookie: sessionCookie } }
              );
              console.log("[PUBBLICA] Risposta:", res.status, JSON.stringify(res.data));
              return { id: res.data?.id, success: true };
            } catch (err: any) {
              console.error("[PUBBLICA] Errore dettagliato:", JSON.stringify(err.response?.data));
              throw err;
            }
          });
            console.log("[PUBBLICA] Body inviato:", JSON.stringify(body, null, 2));
            try {
              const res = await axios.post(
                `${RC_BASE}/api/admin/articles`,
                body,
                { headers: { "Content-Type": "application/json", Cookie: sessionCookie } }
              );
              console.log("[PUBBLICA] Risposta:", res.status, JSON.stringify(res.data));
              return { id: res.data?.id, success: true };
            } catch (err: any) {
              console.error("[PUBBLICA] Errore status:", err.response?.status);
              console.error("[PUBBLICA] Errore body:", JSON.stringify(err.response?.data));
              throw err;
            }
          });

          garaReport.azioni.push(`Articolo creato in bozza — ID: ${pubblicazione.id}`);
          garaReport.azioni.push(`Stile: ${stile.id}`);
        } else {
          garaReport.azioni.push("Classifica vuota — articolo saltato, solo risultati caricati");
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
