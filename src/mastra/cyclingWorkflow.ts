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
      // PCS pubblica i risultati del giorno precedente — usiamo ieri
      const ieri = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      console.log("[PCS] Cercando risultati di ieri:", ieri);
      const html = await fetchPage(`${PCS_BASE}/races.php?date=${ieri}&circuit=&class=&filter=Filter`);
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
          const baseUrl = `${PCS_BASE}${gara.url}`;

          // Prova URL risultati in ordine di priorità
          const urlsToTry = [
            `${baseUrl}/result`,      // tappa singola o gara in linea
            `${baseUrl}/results`,
            baseUrl,
          ];

          let html = "";
          let url = baseUrl;
          for (const u of urlsToTry) {
            const h = await fetchPage(u);
            if (!h.startsWith("ERRORE") && h.length > 1000) {
              html = h;
              url = u;
              console.log("[RISULTATI] URL funzionante:", u);
              break;
            }
          }
          if (!html) return null;

          const $ = cheerio.load(html);
          const classificaArrivo: any[] = [];

          // DEBUG risultati PCS
          console.log("[RISULTATI] URL:", url);
          console.log("[RISULTATI] HTML lunghezza:", html.length);
          console.log("[RISULTATI] Cloudflare:", html.includes("Just a moment"));
          console.log("[RISULTATI] HTML 4000-6000:", html.substring(4000, 6000));
          console.log("[RISULTATI] Tabelle trovate:", $("table").length);
          $("table").each((i, el) => {
            const cls = $(el).attr("class") || "";
            const righe = $(el).find("tr").length;
            console.log(`[RISULTATI] Tabella ${i} class="${cls}" righe=${righe}`);
            if (righe > 2) {
              $(el).find("tr").slice(0, 3).each((j, tr) => {
                console.log(`[RISULTATI]   Riga ${j}:`, $(tr).text().replace(/\s+/g, " ").trim().substring(0, 200));
              });
            }
          });

          // Parole non valide — giorni settimana, stage, numeri, ecc.
          const PAROLE_NON_VALIDE = [
            "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
            "stage","tappa","prologue","prologo","general","gc","dnf","dns","dsq",
            "classification","standings","overall","risultati","classifica"
          ];

          $("table tbody tr, div.result-row").each((i, el) => {
            const $el = $(el);
            const nome = $el.find("td:nth-child(2), .rider-name").text().trim();
            const squadra = $el.find("td:nth-child(3), .team-name").text().trim();
            const tempo = $el.find("td:nth-child(4), .time").text().trim();

            if (!nome) return;

            const nomeLower = nome.toLowerCase();
            const isInvalido = PAROLE_NON_VALIDE.some(p => nomeLower.includes(p));
            const isSoloNumero = /^\d+$/.test(nome);
            const isTroppoCorto = nome.replace(/\s/g, "").length < 4;

            if (isInvalido || isSoloNumero || isTroppoCorto) {
              console.log(`[RISULTATI] ⚠️ Scartato: "${nome}"`);
              return;
            }

            classificaArrivo.push({
              posizione: classificaArrivo.length + 1,
              nome,
              squadra,
              tempo,
              distacco: ""
            });
          });

          console.log("[RISULTATI] Corridori validi:", classificaArrivo.length);
          if (classificaArrivo.length > 0) {
            console.log("[RISULTATI] Top 3:", classificaArrivo.slice(0, 3).map(r => r.nome).join(", "));
          }

          // Validazione minima: meno di 5 corridori = gara non conclusa o in corso
          if (classificaArrivo.length < 5) {
            console.log(`[RISULTATI] ⏭️ Solo ${classificaArrivo.length} corridori validi — gara in corso o non conclusa, skip normale`);
            return null;
          }

          // Prova a prendere anche la General Classification
          const gcArrivo: any[] = [];
          const gcUrls = [
            `${baseUrl}/gc`,
            `${baseUrl}/general-classification`,
            `${PCS_BASE}${gara.url.replace(/\/stage-\d+.*/, "")}/gc`,
          ];

          for (const gcUrl of gcUrls) {
            const gcHtml = await fetchPage(gcUrl);
            if (gcHtml.startsWith("ERRORE") || gcHtml.length < 1000) continue;

            const $gc = cheerio.load(gcHtml);
            $gc("table tbody tr").each((i, el) => {
              const $el = $gc(el);
              const nome = $el.find("td:nth-child(2), .rider-name").text().trim();
              const squadra = $el.find("td:nth-child(3), .team-name").text().trim();
              const tempo = $el.find("td:nth-child(4), .time").text().trim();
              if (!nome) return;
              const nomeLower = nome.toLowerCase();
              const isInvalido = PAROLE_NON_VALIDE.some(p => nomeLower.includes(p));
              if (isInvalido || nome.length < 4) return;
              gcArrivo.push({ posizione: gcArrivo.length + 1, nome, squadra, tempo, distacco: "" });
            });

            if (gcArrivo.length >= 5) {
              console.log("[GC] Classifica generale trovata:", gcArrivo.length, "corridori — URL:", gcUrl);
              break;
            }
          }

          return { classificaArrivo, gcArrivo, percorso: "", distanzaKm: 0, dislivelloM: 0 };
        });

        if (!risultatiPCS) {
          garaReport.azioni.push("Gara in corso o risultati non ancora disponibili — skippata");
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
            const top10Tappa = risultatiPCS.classificaArrivo
              .slice(0, 10)
              .map(r => `${r.posizione}. ${r.nome} (${r.squadra})${r.distacco ? " +" + r.distacco : " [vincitore tappa]"}`)
              .join("\n");

            const hasGC = risultatiPCS.gcArrivo && risultatiPCS.gcArrivo.length >= 5;
            const top10GC = hasGC
              ? risultatiPCS.gcArrivo.slice(0, 10)
                  .map((r: any) => `${r.posizione}. ${r.nome} (${r.squadra})${r.distacco ? " +" + r.distacco : " [leader GC]"}`)
                  .join("\n")
              : null;

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
7. VIETATE le frasi di scusa o mancanza dati: "Non sono stati forniti dati", "Informazione non disponibile", "In base ai dati disponibili". Se un dato non c'è, ometti quel punto — non commentarlo.
8. Se la classifica fornita ha meno di 5 corridori con nomi reali, scrivi SOLO uno stile FLASH NEWS brevissimo senza inventare nulla.

════════════════════════════════
DATI REALI DELLA GARA
════════════════════════════════
Gara: ${gara.nome}
Anno: ${new Date().getFullYear()}
Categoria: ${gara.genere === "women" ? "Ciclismo Femminile" : "Ciclismo Maschile"}
Vincitore di tappa: ${vincitore.nome} (${vincitore.squadra})

Classifica di tappa Top 10:
${top10Tappa}
${top10GC ? `\nClassifica Generale (GC) aggiornata Top 10:\n${top10GC}\nLeader GC: ${risultatiPCS.gcArrivo[0].nome} (${risultatiPCS.gcArrivo[0].squadra})` : "\n(Classifica generale non disponibile per questa tappa)"}

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
Translate this Italian article to professional English journalism.

ABSOLUTE RULES:
1. Translate the ENTIRE content word by word. Do NOT summarize, shorten, or omit any sentence.
2. Keep ALL facts, names, teams, and numbers identical to the Italian version.
3. Do NOT invent anything not present in the Italian text.
4. FORBIDDEN phrases: "No data was provided", "Information not available", "Based on available data", "I was not given". If a fact is in the Italian, translate it. If it is not in the Italian, do not add it.
5. The translated article must be the same length as the Italian original.

Italian title: ${articoloIT.titolo}
Italian content: ${articoloIT.contenuto}`,
              schema: z.object({
                titolo: z.string().min(10),
                excerpt: z.string().min(50),
                contenuto: z.string().min(200),
              }),
            });

            // Validazione: se EN è troppo corto rispetto a IT, usa IT come fallback
            if (result.object.contenuto.length < articoloIT.contenuto.length * 0.7) {
              console.log("[EN] ⚠️ Traduzione troppo corta — uso fallback IT");
              return {
                titolo: result.object.titolo || articoloIT.titolo,
                excerpt: result.object.excerpt || articoloIT.excerpt,
                contenuto: result.object.contenuto.length > 100 ? result.object.contenuto : articoloIT.contenuto,
              };
            }

            return result.object;
          });

          const pubblicazione = await step.run(`pubblica-${gara.nome}`, async () => {
            // 1. Validazione pre-invio
            if (!articoloIT.titolo || !articoloIT.contenuto || !articoloIT.slug) {
              throw new Error(`Dati articolo incompleti per ${gara.nome} — AI ha fallito la generazione`);
            }

            const body = {
              slug: articoloIT.slug.toLowerCase().trim(),
              title: articoloIT.titolo,
              excerpt: articoloIT.excerpt,
              content: `${articoloIT.contenuto}\n\n${articoloIT.dettaglioExtra}`,
              titleEn: articoloEN.titolo || articoloIT.titolo,
              excerptEn: articoloEN.excerpt || articoloIT.excerpt,
              contentEn: articoloEN.contenuto || articoloIT.contenuto,
              author: "AI Agent",
              publishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              hashtags: articoloIT.tags || [],
              published: false,
            };

            console.log("[PUBBLICA] Slug:", body.slug);
            console.log("[PUBBLICA] Titolo:", body.title);
            console.log("[PUBBLICA] Lunghezza content IT:", body.content.length);
            console.log("[PUBBLICA] Lunghezza content EN:", body.contentEn.length);

            try {
              const res = await axios.post(
                `${RC_BASE}/api/admin/articles`,
                body,
                { headers: { "Content-Type": "application/json", Cookie: sessionCookie } }
              );
              console.log("[PUBBLICA] ✅ ID:", res.data?.id || res.data?._id);
              return { id: res.data?.id || res.data?._id || "SUCCESS", success: true };
            } catch (err: any) {
              console.error("[PUBBLICA] ❌ Status:", err.response?.status);
              console.error("[PUBBLICA] ❌ Errore RC:", JSON.stringify(err.response?.data));
              throw new Error(`Server RC ha risposto ${err.response?.status}: ${JSON.stringify(err.response?.data)}`);
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

    // Trigger automatico workflow FCI dopo PCS
    await step.run("trigger-fci-workflow", async () => {
      await inngest.send({ name: "cycling/generate.fci.article", data: {} });
      console.log("[CHAIN] ✅ Workflow FCI triggerato");
    });

    return { success: true, gaareProcessate: gareOggi.length, report };
  }
);
