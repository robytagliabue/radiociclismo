import { inngest } from "./inngest.js";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import axios from "axios";
import pg from "pg";

const { Pool } = pg;
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const RC_BASE = "https://radiociclismo.com";
const BIPRO_URL = "https://bici.pro/news/giovani/";

// ─── Categorie FCI che generano articoli ──────────────────────────────────────
const CATEGORIE_ARTICOLO = ["allievi", "juniores", "under23", "elite"];

// ─── Mapping categoria gara → parametro API ranking RC ───────────────────────
function mapCategoriaToRCRanking(cat: string): string {
  const c = (cat || "").toLowerCase();
  if (c.includes("allievi")) return c.includes("donne") ? "donne_allieve" : "allievi";
  if (c.includes("juniores") || c.includes("junior")) return c.includes("donne") ? "donne_juniores" : "juniores";
  if (c.includes("under23") || c.includes("u23")) return c.includes("donne") ? "donne_under23_elite" : "under23_elite";
  if (c.includes("elite")) return c.includes("donne") ? "donne_under23_elite" : "under23_elite";
  return "under23_elite";
}

// ─── Tipi ─────────────────────────────────────────────────────────────────────
interface RaceRanking {
  position: number;
  name: string;
  team: string;
  category: string;
  status: "classified" | "DNF";
}

interface GaraFCI {
  raceId: number;
  title: string;
  category: string;
  startDate: string;
  location: string;
  slug: string;
  rankings: RaceRanking[];
}

interface AtletaInClassifica {
  name: string;
  team: string;
  posizione: number | null;
  punti: number | null;
  profileUrl: string | null;
}

// ─── Fetch page via curl ─────────────────────────────────────────────────────
import { execSync } from "child_process";

function fetchPage(url: string): string {
  try {
    const result = execSync(
      `curl -4 -s -L --http2 --max-time 30 \
      -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36" \
      -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
      -H "Accept-Language: it-IT,it;q=0.9,en;q=0.8" \
      -H "Accept-Encoding: gzip, deflate, br" \
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

// ─── Struttura articolo bici.pro ──────────────────────────────────────────────
interface BiciProArticolo {
  titolo: string;
  url: string;
  data: string;       // YYYY-MM-DD
  testo: string;      // testo completo estratto dall'articolo
  categoria: string;  // es. "juniores", "allievi"
}

// ─── Scrapa lista articoli di oggi da bici.pro/news/giovani ──────────────────
import * as cheerio from "cheerio";

function scrapaBiciProOggi(): BiciProArticolo[] {
  const html = fetchPage(BIPRO_URL);
  if (html.startsWith("ERRORE")) {
    console.log("[BICI.PRO] Fetch fallito:", html);
    return [];
  }

  const $ = cheerio.load(html);
  const oggi = new Date().toISOString().split("T")[0];
  const articoli: BiciProArticolo[] = [];

  // Selettori tipici per liste news — aggiustare dopo primo deploy
  $("article, .post, .news-item, .entry, li.article").each((_, el) => {
    const $el = $(el);

    const link = $el.find("a[href]").first();
    const url = link.attr("href") || "";
    if (!url || !url.includes("bici.pro")) return;

    const titolo = ($el.find("h2, h3, .title, .entry-title").first().text() || link.text()).trim();
    if (!titolo) return;

    // Estrai data — cerca meta, time[datetime] o testo
    const dateAttr = $el.find("time").attr("datetime") ||
                     $el.find("[datetime]").attr("datetime") || "";
    const dataGara = dateAttr.substring(0, 10);
    if (dataGara !== oggi) return;

    // Categoria dal testo o URL
    const testoLower = (titolo + url).toLowerCase();
    let categoria = "giovani";
    if (testoLower.includes("juniores") || testoLower.includes("junior")) categoria = "juniores";
    else if (testoLower.includes("allievi") || testoLower.includes("allievo")) categoria = "allievi";
    else if (testoLower.includes("under23") || testoLower.includes("u23")) categoria = "under23";
    else if (testoLower.includes("elite")) categoria = "elite";

    articoli.push({ titolo, url, data: dataGara, testo: "", categoria });
  });

  console.log(`[BICI.PRO] Articoli trovati oggi: ${articoli.length}`);
  return articoli;
}

// ─── Fetch testo completo di un singolo articolo bici.pro ────────────────────
function fetchTestoBiciPro(url: string): string {
  const html = fetchPage(url);
  if (html.startsWith("ERRORE")) return "";

  const $ = cheerio.load(html);

  // Rimuovi nav, header, footer, sidebar, script, style
  $("nav, header, footer, aside, script, style, .sidebar, .widget, .comments, .advertisement").remove();

  // Estrai testo dal body dell'articolo
  const testo = (
    $("article .content, .entry-content, .post-content, .article-body, main article").first().text() ||
    $("article").first().text() ||
    $("main").first().text()
  ).replace(/\s+/g, " ").trim();

  return testo.substring(0, 3000); // max 3000 char per il prompt
}

// ─── Session cookie RC ────────────────────────────────────────────────────────
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

// ─── Leggi gare FCI di oggi dal DB ───────────────────────────────────────────
async function getGareFCIOggi(): Promise<GaraFCI[]> {
  const oggi = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  const res = await db.query<{
    race_id: number;
    title: string;
    category: string;
    start_date: Date;
    location: string;
    slug: string;
    rankings: RaceRanking[];
  }>(
    `SELECT
       r.id          AS race_id,
       r.title,
       r.category,
       r.start_date,
       r.location,
       r.slug,
       rr.rankings
     FROM races r
     JOIN race_results rr ON rr.race_id = r.id
     WHERE DATE(r.start_date) = $1
       AND rr.rankings IS NOT NULL
       AND jsonb_array_length(rr.rankings::jsonb) > 0
     ORDER BY r.id`,
    [oggi]
  );

  return res.rows
    .filter(row => {
      const cat = (row.category || "").toLowerCase();
      return CATEGORIE_ARTICOLO.some(c => cat.includes(c));
    })
    .map(row => ({
      raceId: row.race_id,
      title: row.title,
      category: row.category,
      startDate: row.start_date.toISOString().split("T")[0],
      location: row.location || "",
      slug: row.slug,
      rankings: ((row.rankings || []) as RaceRanking[]).filter(r => r.status === "classified"),
    }));
}

// ─── Arricchisci top 10 con posizione in classifica RC Giovani ───────────────
async function arricchisciConClassificaRC(
  riders: RaceRanking[],
  categoriaRC: string
): Promise<AtletaInClassifica[]> {
  let ranking: any[] = [];
  try {
    const res = await axios.get(
      `${RC_BASE}/api/athletes-ranking?season=${new Date().getFullYear()}&category=${categoriaRC}&limit=100`
    );
    ranking = res.data?.athletes ?? res.data ?? [];
  } catch {
    console.log(`[FCI] Classifica RC non disponibile per categoria ${categoriaRC}`);
  }

  return riders.slice(0, 10).map(rider => {
    // FCI usa formato "COGNOME NOME" tutto maiuscolo
    const parts = rider.name.toLowerCase().trim().split(" ");
    const cognome = parts[0] ?? "";
    const nome = parts.slice(1).join(" ");

    const match = ranking.find((a: any) => {
      const aCognome = (a.lastName ?? a.surname ?? "").toLowerCase();
      const aNome = (a.firstName ?? a.name ?? "").toLowerCase();
      return aCognome.includes(cognome) && (nome ? aNome.includes(nome.split(" ")[0]) : true);
    });

    const posizione = match ? ranking.indexOf(match) + 1 : null;

    return {
      name: rider.name,
      team: rider.team,
      posizione,
      punti: match?.points ?? match?.totalPoints ?? null,
      profileUrl: match?.slug ? `${RC_BASE}/giovani/atleta/${match.slug}` : null,
    };
  });
}

// ─── DB: deduplicazione ───────────────────────────────────────────────────────
async function isAlreadyPublished(raceName: string): Promise<boolean> {
  const res = await db.query(
    "SELECT id FROM published_articles WHERE race_name = $1 LIMIT 1",
    [raceName]
  );
  return (res.rowCount ?? 0) > 0;
}

async function savePublished(slug: string, titleIt: string, raceName: string): Promise<void> {
  await db.query(
    `INSERT INTO published_articles (slug, title_it, race_name, source_url)
     VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING`,
    [slug, titleIt, raceName, `${RC_BASE}/giovani`]
  );
}

// ─── Formatta classifica per il prompt ───────────────────────────────────────
function formatClassificaPerPrompt(atleti: AtletaInClassifica[]): string {
  return atleti.map((a, i) => {
    const pos = i + 1;
    const rcInfo = a.posizione
      ? `→ #${a.posizione} classifica RC Giovani (${a.punti ?? "?"} pt)`
      : "→ non in classifica RC Giovani";
    return `${pos}. ${a.name} (${a.team}) ${rcInfo}`;
  }).join("\n");
}

// ─── Workflow Inngest ─────────────────────────────────────────────────────────
export const fciWorkflowFn = inngest.createFunction(
  {
    id: "fci-workflow",
    name: "RadioCiclismo — Articoli Gare FCI Italiane",
    concurrency: { limit: 1 },
  },
  { event: "cycling/generate.fci.article" },

  async ({ event, step }) => {
    const report: any[] = [];

    // 1. Login RC
    const sessionCookie = await step.run("fci-login-rc", async () => {
      const cookie = await getSessionCookie();
      if (!cookie) throw new Error("Login RC fallito");
      return cookie;
    });

    // 2. Leggi gare FCI di oggi dal DB
    const gareOggi = await step.run("fci-fetch-gare-db", async () => {
      const gare = await getGareFCIOggi();
      console.log(`[FCI] Gare trovate oggi: ${gare.length}`);
      gare.forEach(g =>
        console.log(`[FCI]  → "${g.title}" (${g.category}) — ${g.rankings.length} classificati`)
      );
      return gare;
    });

    if (gareOggi.length === 0) {
      return { success: true, message: "Nessuna gara FCI con risultati oggi", report };
    }

    // 3. Processa ogni gara
    for (const gara of gareOggi) {
      const garaReport: any = { nome: gara.title, azioni: [] };

      try {
        // 3a. Check deduplicazione
        const gia = await step.run(`fci-check-${gara.raceId}`, async () => {
          const exists = await isAlreadyPublished(gara.title);
          console.log(`[FCI] "${gara.title}" già pubblicata: ${exists}`);
          return exists;
        });

        if (gia) {
          garaReport.azioni.push("Già pubblicata — skippata");
          report.push(garaReport);
          continue;
        }

        // 3b. Arricchisci top 10 con classifica RC Giovani
        const atletiArricchiti = await step.run(`fci-ranking-${gara.raceId}`, async () => {
          const categoriaRC = mapCategoriaToRCRanking(gara.category);
          const atleti = await arricchisciConClassificaRC(gara.rankings, categoriaRC);
          const trovati = atleti.filter(a => a.posizione).length;
          console.log(`[FCI] "${gara.title}" — ${trovati}/${atleti.length} atleti in classifica RC`);
          return atleti;
        });

        // 3c. Genera articolo IT
        const articoloIT = await step.run(`fci-genera-it-${gara.raceId}`, async () => {
          const vincitore = atletiArricchiti[0];
          const anno = new Date().getFullYear();
          const classificaFormattata = formatClassificaPerPrompt(atletiArricchiti);
          const urlClassifica = `${RC_BASE}/giovani`;

          const result = await generateObject({
            model: google("gemini-2.5-flash-lite"),
            prompt: `Sei un redattore sportivo specializzato in ciclismo giovanile italiano per RadioCiclismo.com.

════════════════════════════════
REGOLE ASSOLUTE — NON DEROGABILI
════════════════════════════════
1. Usa ESCLUSIVAMENTE i dati forniti. Zero invenzioni, zero biografie romanzate.
2. Il vincitore è ${vincitore.name} (${vincitore.team}). Deve comparire nel titolo.
3. MAI usare placeholder come [VINCITORE], [SQUADRA], [DISTACCO].
4. Se un dato manca, omettilo o scrivi "dato non disponibile".
5. FALLBACK: se non hai dettagli tattici, usa stile FLASH NEWS — fatti diretti e classifica.
6. Includi SEMPRE il link ${urlClassifica} nel corpo dell'articolo.

════════════════════════════════
DATI REALI DELLA GARA
════════════════════════════════
Gara: ${gara.title}
Anno: ${anno}
Categoria: ${gara.category}
Luogo: ${gara.location || "Italia"}
Data: ${gara.startDate}

Top 10 con posizione in Classifica RC Giovani ${anno}:
${classificaFormattata}

════════════════════════════════
STRUTTURA OBBLIGATORIA
════════════════════════════════
1. APERTURA: chi ha vinto, gara, categoria, luogo.
2. TOP 5: classifica con squadre.
3. CLASSIFICA RC GIOVANI: come si posizionano vincitore e piazzati nella classifica RadioCiclismo.
   - Se qualcuno è nelle prime 10 posizioni RC, evidenzialo con entusiasmo.
   - Se nessuno è in classifica RC, scrivi che la vittoria può essere l'inizio del percorso.
   - Chiudi questo paragrafo con: "Segui la classifica aggiornata su ${urlClassifica}"
4. CHIUSURA: significato del risultato per la stagione ${anno}.

Lunghezza: 200-280 parole. Titolo: deve contenere nome gara + nome vincitore.
Slug: kebab-case con nome-gara-categoria-anno.
Tags: 3 tag specifici (nome gara, nome vincitore, categoria).`,
            schema: z.object({
              titolo: z.string(),
              excerpt: z.string(),
              contenuto: z.string(),
              metaDescription: z.string(),
              slug: z.string(),
              tags: z.array(z.string()),
              versioneSocial: z.string(),
            }),
          });
          return result.object;
        });

        // 3d. Genera versione EN
        const articoloEN = await step.run(`fci-genera-en-${gara.raceId}`, async () => {
          const result = await generateObject({
            model: google("gemini-2.5-flash-lite"),
            prompt: `You are a cycling sports journalist for RadioCiclismo.com.
Translate and adapt this Italian article to professional English. Keep all facts identical. Do not invent anything.

Italian title: ${articoloIT.titolo}
Italian content: ${articoloIT.contenuto}`,
            schema: z.object({
              titolo: z.string(),
              excerpt: z.string(),
              contenuto: z.string(),
            }),
          });
          return result.object;
        });

        // 3e. Pubblica su RC
        const pubblicazione = await step.run(`fci-pubblica-${gara.raceId}`, async () => {
          const body = {
            slug: articoloIT.slug,
            title: articoloIT.titolo,
            excerpt: articoloIT.excerpt,
            content: articoloIT.contenuto,
            titleEn: articoloEN.titolo,
            excerptEn: articoloEN.excerpt,
            contentEn: articoloEN.contenuto,
            author: "AI Agent",
            publishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // +1h
            images: [],
            hashtags: articoloIT.tags,
            published: false,
          };

          console.log("[FCI PUBBLICA] Slug:", body.slug, "| Titolo:", body.title);

          try {
            const res = await axios.post(
              `${RC_BASE}/api/admin/articles`,
              body,
              { headers: { "Content-Type": "application/json", Cookie: sessionCookie } }
            );
            console.log("[FCI PUBBLICA] ✅ ID:", res.data?.id);
            await savePublished(body.slug, body.title, gara.title);
            return { id: res.data?.id, success: true };
          } catch (err: any) {
            console.error("[FCI PUBBLICA] ❌ Status:", err.response?.status);
            console.error("[FCI PUBBLICA] ❌ Body:", JSON.stringify(err.response?.data));
            throw err;
          }
        });

        garaReport.azioni.push(`✅ Articolo creato — ID: ${pubblicazione.id}`);
        garaReport.azioni.push(
          `Atleti in classifica RC: ${atletiArricchiti.filter(a => a.posizione).length}/${atletiArricchiti.length}`
        );

      } catch (err: any) {
        garaReport.azioni.push(`❌ ERRORE: ${err.message}`);
        console.error(`[FCI] Errore su "${gara.title}":`, err.message);
      }

      report.push(garaReport);
    }

    // 4. Pipeline bici.pro — indipendente da FCI
    const articoliBiciPro = await step.run("bipro-fetch-lista", async () => {
      const lista = scrapaBiciProOggi();
      console.log(`[BICI.PRO] ${lista.length} articoli da processare`);
      return lista;
    });

    for (const art of articoliBiciPro) {
      const artReport: any = { nome: art.titolo, fonte: "bici.pro", azioni: [] };

      try {
        // Check deduplicazione per titolo
        const gia = await step.run(`bipro-check-${encodeURIComponent(art.url).substring(0, 40)}`, async () => {
          const res = await db.query(
            "SELECT id FROM published_articles WHERE race_name = $1 OR slug LIKE $2 LIMIT 1",
            [art.titolo, `%${art.url.split("/").filter(Boolean).pop()}%`]
          );
          return (res.rowCount ?? 0) > 0;
        });

        if (gia) {
          artReport.azioni.push("Già pubblicato — skippato");
          report.push(artReport);
          continue;
        }

        // Fetch testo completo
        const testo = await step.run(`bipro-fetch-testo-${encodeURIComponent(art.url).substring(0, 40)}`, async () => {
          const t = fetchTestoBiciPro(art.url);
          console.log(`[BICI.PRO] Testo estratto per "${art.titolo}": ${t.length} char`);
          if (t.length < 100) {
            console.log(`[BICI.PRO] Testo troppo corto — DEBUG HTML 0-500:`);
            const html = fetchPage(art.url);
            console.log(html.substring(0, 500));
          }
          return t;
        });

        if (testo.length < 50) {
          artReport.azioni.push("Testo non estratto — skippato");
          report.push(artReport);
          continue;
        }

        // Cerca atleti menzionati nella classifica RC
        const categoriaRC = mapCategoriaToRCRanking(art.categoria);
        const classificaRC = await step.run(`bipro-ranking-${encodeURIComponent(art.url).substring(0, 40)}`, async () => {
          try {
            const res = await axios.get(
              `${RC_BASE}/api/athletes-ranking?season=${new Date().getFullYear()}&category=${categoriaRC}&limit=20`
            );
            const ranking: any[] = res.data?.athletes ?? res.data ?? [];
            // Cerca i primi 20 della classifica che compaiono nel testo
            return ranking.slice(0, 20).filter((a: any) => {
              const cognome = (a.lastName ?? "").toLowerCase();
              return cognome.length >= 3 && testo.toLowerCase().includes(cognome);
            }).slice(0, 5).map((a: any, idx: number) => ({
              name: `${a.lastName ?? ""} ${a.firstName ?? ""}`.trim(),
              posizione: ranking.indexOf(a) + 1,
              punti: a.points ?? a.totalPoints ?? null,
              profileUrl: a.slug ? `${RC_BASE}/giovani/atleta/${a.slug}` : null,
            }));
          } catch { return []; }
        });

        // Genera articolo IT
        const articoloIT = await step.run(`bipro-genera-it-${encodeURIComponent(art.url).substring(0, 40)}`, async () => {
          const anno = new Date().getFullYear();
          const urlClassifica = `${RC_BASE}/giovani`;

          const rcInfo = classificaRC.length > 0
            ? `Atleti della classifica RC Giovani ${anno} presenti nell'articolo:
` +
              classificaRC.map((a: any) => `- ${a.name}: #${a.posizione} in classifica RC (${a.punti ?? "?"} pt)`).join("
")
            : `Nessun atleta trovato nella classifica RC Giovani ${anno} — scrivi ugualmente l'articolo.`;

          const result = await generateObject({
            model: google("gemini-2.5-flash-lite"),
            prompt: `Sei un redattore sportivo specializzato in ciclismo giovanile italiano per RadioCiclismo.com.

════════════════════════════════
REGOLE ASSOLUTE
════════════════════════════════
1. Riscrivi l'articolo con stile RC usando SOLO i fatti presenti nel testo sorgente.
2. Zero invenzioni, zero dichiarazioni inventate, zero dati non presenti nel testo.
3. MAI usare placeholder come [VINCITORE] o [SQUADRA].
4. Includi SEMPRE il link ${urlClassifica} nel corpo dell'articolo.
5. FALLBACK: se il testo è scarso di dati, usa stile FLASH NEWS — fatti diretti.

════════════════════════════════
TESTO SORGENTE (da bici.pro)
════════════════════════════════
Titolo originale: ${art.titolo}
Categoria: ${art.categoria}
Data: ${art.data}
URL originale: ${art.url}

Testo:
${testo}

════════════════════════════════
DATI CLASSIFICA RC GIOVANI ${anno}
════════════════════════════════
${rcInfo}

════════════════════════════════
STRUTTURA
════════════════════════════════
1. APERTURA: fatto principale (chi, cosa, dove).
2. DETTAGLIO: sviluppo della gara o notizia dai dati reali.
3. CLASSIFICA RC GIOVANI: posizione degli atleti citati nella classifica RC.
   Chiudi con: "Segui la classifica aggiornata su ${urlClassifica}"
4. CHIUSURA: significato per la stagione ${anno}.

Lunghezza: 180-260 parole. Titolo: informativo, con nome gara/atleta principale.
Slug: kebab-case. Tags: 3 tag specifici.`,
            schema: z.object({
              titolo: z.string(),
              excerpt: z.string(),
              contenuto: z.string(),
              metaDescription: z.string(),
              slug: z.string(),
              tags: z.array(z.string()),
              versioneSocial: z.string(),
            }),
          });
          return result.object;
        });

        // Genera versione EN
        const articoloEN = await step.run(`bipro-genera-en-${encodeURIComponent(art.url).substring(0, 40)}`, async () => {
          const result = await generateObject({
            model: google("gemini-2.5-flash-lite"),
            prompt: `You are a cycling journalist for RadioCiclismo.com.
Translate and adapt this Italian article to professional English. Keep all facts identical.

Italian title: ${articoloIT.titolo}
Italian content: ${articoloIT.contenuto}`,
            schema: z.object({
              titolo: z.string(),
              excerpt: z.string(),
              contenuto: z.string(),
            }),
          });
          return result.object;
        });

        // Pubblica su RC
        const pub = await step.run(`bipro-pubblica-${encodeURIComponent(art.url).substring(0, 40)}`, async () => {
          const body = {
            slug: articoloIT.slug,
            title: articoloIT.titolo,
            excerpt: articoloIT.excerpt,
            content: articoloIT.contenuto,
            titleEn: articoloEN.titolo,
            excerptEn: articoloEN.excerpt,
            contentEn: articoloEN.contenuto,
            author: "AI Agent",
            publishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            images: [],
            hashtags: articoloIT.tags,
            published: false,
          };
          try {
            const res = await axios.post(
              `${RC_BASE}/api/admin/articles`,
              body,
              { headers: { "Content-Type": "application/json", Cookie: sessionCookie } }
            );
            console.log("[BICI.PRO PUBBLICA] ✅ ID:", res.data?.id);
            await db.query(
              `INSERT INTO published_articles (slug, title_it, race_name, source_url)
               VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING`,
              [body.slug, body.title, art.titolo, art.url]
            );
            return { id: res.data?.id, success: true };
          } catch (err: any) {
            console.error("[BICI.PRO PUBBLICA] ❌", err.response?.status, JSON.stringify(err.response?.data));
            throw err;
          }
        });

        artReport.azioni.push(`✅ Articolo creato — ID: ${pub.id}`);
        artReport.azioni.push(`Atleti RC trovati: ${classificaRC.length}`);

      } catch (err: any) {
        artReport.azioni.push(`❌ ERRORE: ${err.message}`);
      }

      report.push(artReport);
    }

    return {
      success: true,
      gareProcessate: gareOggi.length,
      articoliBiciPro: articoliBiciPro.length,
      report,
    };
  }
);
