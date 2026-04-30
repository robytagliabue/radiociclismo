/**
 * cycling-fci-v2.ts  →  src/mastra/cycling-fci.ts
 * RadioCiclismo — Nazionali e Giovanili
 *
 * Pipeline per ogni gara FCI dal DB:
 *  1. Login RC
 *  2. Fetch gare di oggi dal DB (classifiche già caricate dal CSV worker)
 *  3. Fase di Investigazione: analisi intento articolo sorgente (preview/live/report)
 *  4. Incrocio con /api/admin/races di RC → verifica se la gara è già censita + ha risultati
 *  5. Arricchimento con Classifica RC Giovani (atleti nominati → posizione ranking)
 *  6. Generazione articolo IT con Anthropic claude-sonnet-4-20250514
 *  7. Traduzione EN
 *  8. Pubblicazione su RC (bozza, publishAt +2h)
 *
 * Pipeline parallela (scraping):
 *  - bici.pro/news/giovani
 *  - federciclismo.it/strada
 *  Stessa logica: investigazione → incrocio RC → ranking → genera IT → EN → pubblica
 */

import { inngest } from "../client.js";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";
import { pool } from "./db.js";

// ─── Costanti ─────────────────────────────────────────────────────────────────
const RC_BASE = "https://radiociclismo.com";
const BIPRO_URL = "https://bici.pro/news/giovani/";
const FCI_STRADA_URL =
  "https://www.federciclismo.it/it/article-archive/98717172-e565-4965-b6ca-b830d6961633/";

// Modello Anthropic — snapshot esplicita per stabilità in produzione
const MODEL = anthropic("claude-sonnet-4-20250514");

// Solo queste categorie generano articoli
const CATEGORIE_ARTICOLO = ["allievi", "juniores", "under23", "elite"];

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
  fciRaceId: string | null;
  rankings: RaceRanking[];
}

interface AtletaInClassifica {
  name: string;
  team: string;
  posizione: number | null;
  punti: number | null;
  profileUrl: string | null;
}

type IntentType = "preview" | "live" | "report_finale" | "sconosciuto";

interface ArticleInvestigation {
  intent: IntentType;
  gareNominate: string[];
  categorieNominate: string[];
  vincitoreNominato: string | null;
  hasResults: boolean;
}

interface BiciProArticolo {
  titolo: string;
  url: string;
  data: string;
  testo: string;
  categoria: string;
}

// ─── Fetch pagina con curl (User-Agent reale per evitare blocchi) ─────────────
function fetchPage(url: string): string {
  try {
    return execSync(
      `curl -4 -s -L --http2 --max-time 30 \
      -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36" \
      -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
      -H "Accept-Language: it-IT,it;q=0.9,en;q=0.8" \
      -H "Accept-Encoding: gzip, deflate, br" \
      -H "Upgrade-Insecure-Requests: 1" \
      --compressed "${url}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    ).toString();
  } catch (e: any) {
    return `ERRORE: ${e.message}`;
  }
}

// ─── Slugify ──────────────────────────────────────────────────────────────────
const slugify = (t: string) =>
  t
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .substring(0, 80);

// ─── Mapping categoria → parametro ranking RC ─────────────────────────────────
function mapCategoriaToRCRanking(cat: string): string {
  const c = (cat || "").toLowerCase();
  if (c.includes("allievi"))
    return c.includes("donne") ? "donne_allieve" : "allievi";
  if (c.includes("juniores") || c.includes("junior"))
    return c.includes("donne") ? "donne_juniores" : "juniores";
  if (c.includes("under23") || c.includes("u23"))
    return c.includes("donne") ? "donne_under23_elite" : "under23_elite";
  if (c.includes("elite"))
    return c.includes("donne") ? "donne_under23_elite" : "under23_elite";
  return "under23_elite";
}

// ─── Auth RC ──────────────────────────────────────────────────────────────────
async function getSessionCookie(): Promise<string> {
  const res = await axios.post(
    `${RC_BASE}/api/admin/login`,
    { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD },
    {
      headers: { "Content-Type": "application/json" },
      maxRedirects: 0,
      validateStatus: (s) => s < 400,
    }
  );
  const cookies = res.headers["set-cookie"] || [];
  for (const c of cookies) {
    if (c.includes("connect.sid")) return c.split(";")[0];
  }
  return cookies[0]?.split(";")[0] ?? "";
}

// ─── Deduplicazione articoli RC ───────────────────────────────────────────────
async function isAlreadyPublished(titolo: string, cookie: string): Promise<boolean> {
  try {
    const res = await axios.get(
      `${RC_BASE}/api/admin/articles?search=${encodeURIComponent(titolo.substring(0, 30))}&limit=5`,
      { headers: { Cookie: cookie } }
    );
    const articles = res.data?.articles ?? res.data ?? [];
    return articles.some((a: any) =>
      a.title?.toLowerCase().includes(titolo.toLowerCase().substring(0, 20))
    );
  } catch {
    return false;
  }
}

// ─── Leggi gare FCI di oggi dal DB ───────────────────────────────────────────
// Queste gare hanno già la classifica caricata dal CSV worker
async function getGareFCIOggi(): Promise<GaraFCI[]> {
  const oggi = new Date();
  const ieri = new Date(oggi);
  ieri.setDate(ieri.getDate() - 1);
  const dateOggi = oggi.toISOString().split("T")[0];
  const dateIeri = ieri.toISOString().split("T")[0];

  // Cerca gare di oggi e ieri con risultati caricati dallo scraper FCI
  // Usa upload_source = 'fci_scraper' per escludere inserimenti manuali
  const res = await pool.query<{
    race_id: number;
    title: string;
    category: string;
    start_date: Date;
    location: string;
    slug: string;
    fci_race_id: string | null;
    rankings: RaceRanking[];
  }>(
    `SELECT
       r.id            AS race_id,
       r.title,
       r.category,
       r.start_date,
       r.location,
       r.slug,
       r.fci_race_id,
       rr.rankings
     FROM races r
     JOIN race_results rr ON rr.race_id = r.id
     WHERE DATE(r.start_date) IN ($1, $2)
       AND rr.upload_source = 'fci_scraper'
       AND rr.rankings IS NOT NULL
       AND jsonb_array_length(rr.rankings) > 0
     ORDER BY r.start_date DESC, r.id`,
    [dateOggi, dateIeri]
  );

  return res.rows
    .filter((row) => {
      const cat = (row.category || "").toLowerCase();
      return CATEGORIE_ARTICOLO.some((c) => cat.includes(c));
    })
    .map((row) => ({
      raceId: row.race_id,
      title: row.title,
      category: row.category,
      startDate: row.start_date.toISOString().split("T")[0],
      location: row.location || "",
      slug: row.slug,
      fciRaceId: row.fci_race_id ?? null,
      rankings: ((row.rankings || []) as RaceRanking[]).filter(
        (r) => r.status === "classified"
      ),
    }));
}

// ─── FASE 1: Investigazione intento articolo ──────────────────────────────────
// L'AI analizza titolo + testo e capisce se è preview, live o report finale.
// Estrae anche gare nominate, categorie e vincitore (se presente).
async function investigaArticolo(
  titolo: string,
  testo: string
): Promise<ArticleInvestigation> {
  try {
    const result = await generateObject({
      model: MODEL,
      prompt: `Analizza questo articolo di ciclismo italiano e classifica il suo intento.

Titolo: ${titolo}
Testo (prime 800 char): ${testo.substring(0, 800)}

Rispondi SOLO con il JSON richiesto:
- intent: "preview" se parla di una gara futura, "live" se è cronaca in corso, "report_finale" se ha risultati definitivi, "sconosciuto" se non è chiaro
- gareNominate: array con i nomi esatti delle gare/corse citate (es. ["Trofeo Comune di Ripatransone"])
- categorieNominate: array delle categorie citate (es. ["Juniores", "Allievi"])
- vincitoreNominato: stringa con il nome del vincitore se presente, altrimenti null
- hasResults: true se l'articolo contiene una classifica o risultati definitivi`,
      schema: z.object({
        intent: z.enum(["preview", "live", "report_finale", "sconosciuto"]),
        gareNominate: z.array(z.string()),
        categorieNominate: z.array(z.string()),
        vincitoreNominato: z.string().nullable(),
        hasResults: z.boolean(),
      }),
    });
    return result.object;
  } catch {
    return {
      intent: "sconosciuto",
      gareNominate: [],
      categorieNominate: [],
      vincitoreNominato: null,
      hasResults: false,
    };
  }
}

// ─── FASE 2a: Incrocio con API RC races ───────────────────────────────────────
// L'API restituisce un array piatto (no paginazione, no wrapper).
// Strategia: prima match deterministico per fciRaceId (se disponibile),
// poi fuzzy match sul titolo (Levenshtein semplificato).
// "hasResults" = state === "archived" (gara conclusa con risultati caricati).

interface RCRace {
  id: number;
  slug: string;
  title: string;
  category: string;
  startDate: string;
  state: "upcoming" | "in_progress" | "archived";
  status: "pending" | "approved" | "rejected";
  fciRaceId: string | null;
  uciRaceId: string | null;
  region: string | null;
}

// Distanza di Levenshtein semplificata per fuzzy match titoli
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function normalizzaTitolo(t: string): string {
  return t.toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Cache in-memory per evitare chiamate ripetute nella stessa esecuzione
let rcRacesCache: RCRace[] | null = null;

async function fetchRCRaces(cookie: string): Promise<RCRace[]> {
  if (rcRacesCache) return rcRacesCache;
  try {
    const res = await axios.get(
      `${RC_BASE}/api/admin/races?status=approved`,
      { headers: { Cookie: cookie } }
    );
    rcRacesCache = Array.isArray(res.data) ? res.data : [];
    console.log(`[RC RACES] Caricate ${rcRacesCache.length} gare approvate`);
    return rcRacesCache;
  } catch (e: any) {
    console.error("[RC RACES] Fetch fallito:", e.message);
    return [];
  }
}

async function incrociaCongRC(
  nomeGara: string,
  cookie: string,
  fciRaceId?: string | null
): Promise<{ found: boolean; raceId?: number; slug?: string; hasResults: boolean; race?: RCRace }> {
  const races = await fetchRCRaces(cookie);
  if (!races.length) return { found: false, hasResults: false };

  // 1. Match deterministico per fciRaceId (più affidabile)
  if (fciRaceId) {
    const exact = races.find(r => r.fciRaceId === fciRaceId);
    if (exact) {
      console.log(`[RC MATCH] Deterministico fciRaceId="${fciRaceId}" → "${exact.title}"`);
      return {
        found: true,
        raceId: exact.id,
        slug: exact.slug,
        hasResults: exact.state === "archived",
        race: exact,
      };
    }
  }

  // 2. Fuzzy match sul titolo normalizzato
  const nomeNorm = normalizzaTitolo(nomeGara);
  let bestMatch: RCRace | null = null;
  let bestScore = Infinity;

  for (const race of races) {
    const raceNorm = normalizzaTitolo(race.title);
    // Shortcut: se uno contiene l'altro, priorità massima
    if (raceNorm.includes(nomeNorm) || nomeNorm.includes(raceNorm)) {
      bestMatch = race;
      bestScore = 0;
      break;
    }
    const dist = levenshtein(nomeNorm, raceNorm);
    // Score relativo alla lunghezza (tolleranza ~30%)
    const score = dist / Math.max(nomeNorm.length, raceNorm.length);
    if (score < bestScore) {
      bestScore = score;
      bestMatch = race;
    }
  }

  // Soglia: accetta match solo se similarità > 70%
  if (bestMatch && bestScore < 0.3) {
    console.log(`[RC MATCH] Fuzzy "${nomeGara}" → "${bestMatch.title}" (score: ${bestScore.toFixed(2)})`);
    return {
      found: true,
      raceId: bestMatch.id,
      slug: bestMatch.slug,
      hasResults: bestMatch.state === "archived",
      race: bestMatch,
    };
  }

  console.log(`[RC MATCH] Nessun match per "${nomeGara}" (miglior score: ${bestScore.toFixed(2)})`);
  return { found: false, hasResults: false };
}

// ─── FASE 2b: Arricchisci top 10 con posizione in Classifica RC Giovani ───────
// Per gare con classifica strutturata (dal DB)
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
    console.log(`[FCI] Classifica RC non disponibile per ${categoriaRC}`);
  }

  return riders.slice(0, 10).map((rider) => {
    // FCI usa "COGNOME NOME" tutto maiuscolo
    const parts = rider.name.toLowerCase().trim().split(" ");
    const cognome = parts[0] ?? "";
    const nome = parts.slice(1).join(" ");

    const match = ranking.find((a: any) => {
      const aCognome = (a.lastName ?? a.surname ?? "").toLowerCase();
      const aNome = (a.firstName ?? a.name ?? "").toLowerCase();
      return (
        aCognome.includes(cognome) &&
        (nome ? aNome.includes(nome.split(" ")[0]) : true)
      );
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

// ─── Cerca atleti per cognome nel testo ───────────────────────────────────────
// Per articoli scraping (bici.pro / fci strada) — cerca cognomi RC nel testo libero
async function cercaAtletiInTesto(
  testo: string,
  categoriaRC: string
): Promise<AtletaInClassifica[]> {
  let ranking: any[] = [];
  try {
    const res = await axios.get(
      `${RC_BASE}/api/athletes-ranking?season=${new Date().getFullYear()}&category=${categoriaRC}&limit=100`
    );
    ranking = res.data?.athletes ?? res.data ?? [];
  } catch {
    return [];
  }

  const testoLower = testo.toLowerCase();
  return ranking
    .slice(0, 100)
    .filter((a: any) => {
      const cognome = (a.lastName ?? "").toLowerCase();
      return cognome.length >= 3 && testoLower.includes(cognome);
    })
    .slice(0, 5)
    .map((a: any) => ({
      name: `${a.lastName ?? ""} ${a.firstName ?? ""}`.trim(),
      team: a.team ?? "",
      posizione: ranking.indexOf(a) + 1,
      punti: a.points ?? a.totalPoints ?? null,
      profileUrl: a.slug ? `${RC_BASE}/giovani/atleta/${a.slug}` : null,
    }));
}

// ─── Formatta classifica per il prompt ───────────────────────────────────────
function formatClassificaPerPrompt(atleti: AtletaInClassifica[]): string {
  if (!atleti.length) return "Nessun dato classifica disponibile.";
  return atleti
    .map((a, i) => {
      const rcInfo = a.posizione
        ? `→ #${a.posizione} Classifica RC Giovani (${a.punti ?? "?"} pt)${a.profileUrl ? ` — ${a.profileUrl}` : ""}`
        : "→ non presente in Classifica RC Giovani";
      return `${i + 1}. ${a.name} (${a.team}) ${rcInfo}`;
    })
    .join("\n");
}

// ─── Estrai testo pulito da HTML ──────────────────────────────────────────────
function estraiTesto(html: string): string {
  if (html.startsWith("ERRORE")) return "";
  const $ = cheerio.load(html);
  $(
    "nav, header, footer, aside, script, style, .sidebar, .widget, .comments, .advertisement, .menu"
  ).remove();
  const testo = (
    $(".article-body, .entry-content, .post-content, .content-articolo, .testo, article .content, main article")
      .first()
      .text() ||
    $("article").first().text() ||
    $("main").first().text()
  )
    .replace(/\s+/g, " ")
    .trim();
  return testo.substring(0, 3000);
}

// ─── FASE 3: Genera articolo IT ───────────────────────────────────────────────
async function generaArticoloIT(params: {
  titolo: string;
  categoria: string;
  data: string;
  luogo: string;
  classificaFormattata: string;
  testo?: string;
  vincitore?: string | null;
  intent: IntentType;
  garaInRC: boolean;
  rcHasResults: boolean;
}) {
  const anno = new Date().getFullYear();
  const urlClassifica = `${RC_BASE}/giovani`;

  const intenzioneLabel: Record<IntentType, string> = {
    preview: "PREVIEW — presentazione gara futura",
    live: "LIVE — cronaca in corso",
    report_finale: "REPORT FINALE — risultati definitivi",
    sconosciuto: "NOTIZIA GENERICA",
  };

  // Nota contestuale sull'incrocio con il DB RC
  const notaRC = params.garaInRC
    ? params.rcHasResults
      ? `⚠️ Questa gara è già nel database RadioCiclismo con risultati ufficiali caricati dal sistema CSV. Usa quei dati come fonte primaria per la classifica.`
      : `ℹ️ La gara è registrata in RadioCiclismo ma i risultati non sono ancora disponibili.`
    : `ℹ️ La gara non è ancora censita nel database RadioCiclismo.`;

  const result = await generateObject({
    model: MODEL,
    prompt: `Sei un redattore sportivo di RadioCiclismo.com, specializzato in ciclismo giovanile italiano.

════════════════════════════════
TIPO DI CONTENUTO: ${intenzioneLabel[params.intent]}
════════════════════════════════

════════════════════════════════
REGOLE ASSOLUTE — NON DEROGABILI
════════════════════════════════
1. Usa ESCLUSIVAMENTE i dati forniti. Zero invenzioni, zero biografie romanzate.
2. MAI usare placeholder come [VINCITORE], [SQUADRA], [DISTACCO].
3. Se un dato manca, omettilo — non inventarlo mai.
4. Includi SEMPRE il link ${urlClassifica} nel corpo dell'articolo.
5. Se è una PREVIEW: non inventare risultati. Parla della gara in arrivo e della posta in gioco.
6. Se è LIVE o REPORT FINALE: usa la classifica fornita come fonte primaria.
7. FALLBACK: se i dati sono scarsi, usa stile FLASH NEWS — fatti diretti, niente fronzoli.

════════════════════════════════
DATI GARA
════════════════════════════════
Gara: ${params.titolo}
Categoria: ${params.categoria}
Data: ${params.data}
Luogo: ${params.luogo || "Italia"}
${params.vincitore ? `Vincitore: ${params.vincitore}` : ""}
${params.testo ? `\nTesto sorgente:\n${params.testo}` : ""}

${notaRC}

════════════════════════════════
CLASSIFICA RC GIOVANI ${anno}
(Atleti citati, con posizione nel ranking RadioCiclismo)
════════════════════════════════
${params.classificaFormattata}

════════════════════════════════
STRUTTURA OBBLIGATORIA
════════════════════════════════
1. APERTURA: fatto principale (chi, cosa, dove) — adattato al tipo di contenuto.
2. SVILUPPO: classifica con squadre, o anteprima partenti se preview.
3. CLASSIFICA RC GIOVANI: posizione degli atleti citati nel ranking RadioCiclismo.
   • Se qualcuno è nelle prime 10 RC, evidenzialo con entusiasmo.
   • Se nessuno è classificato RC, scrivi che la vittoria può essere l'inizio del percorso.
   • Chiudi SEMPRE con: "Segui la classifica aggiornata su ${urlClassifica}"
4. CHIUSURA: significato per la stagione ${anno}.

Lunghezza: 200-280 parole.
Titolo: deve contenere nome gara + nome vincitore (se disponibile).
Slug: kebab-case, formato nome-gara-categoria-anno.
Tags: esattamente 3 tag specifici (nome gara, nome vincitore o categoria, anno).`,
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
}

// ─── Genera traduzione EN ─────────────────────────────────────────────────────
async function generaArticoloEN(titoloIT: string, contenutoIT: string) {
  const result = await generateObject({
    model: MODEL,
    prompt: `You are a cycling sports journalist for RadioCiclismo.com.
Translate the following Italian article to professional English.
Keep ALL facts identical. Do NOT summarize or omit any sentence.

Italian title: ${titoloIT}
Italian content: ${contenutoIT}`,
    schema: z.object({
      titolo: z.string(),
      excerpt: z.string(),
      contenuto: z.string(),
    }),
  });
  return result.object;
}

// ─── Pubblica articolo su RC ──────────────────────────────────────────────────
async function pubblicaArticolo(
  articoloIT: {
    titolo: string;
    excerpt: string;
    contenuto: string;
    slug: string;
    tags: string[];
  },
  articoloEN: { titolo: string; excerpt: string; contenuto: string },
  sessionCookie: string
): Promise<{ id: string | number; success: boolean }> {
  if (!articoloIT.titolo || !articoloIT.contenuto || !articoloIT.slug) {
    throw new Error("Dati articolo incompleti — titolo, contenuto o slug mancanti");
  }

  const body = {
    slug: articoloIT.slug.toLowerCase().trim(),
    title: articoloIT.titolo,
    excerpt: articoloIT.excerpt,
    content: articoloIT.contenuto,
    titleEn: articoloEN.titolo || articoloIT.titolo,
    excerptEn: articoloEN.excerpt || articoloIT.excerpt,
    contentEn: articoloEN.contenuto || articoloIT.contenuto,
    author: "AI Agent",
    publishAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // +2h
    images: [],
    hashtags: articoloIT.tags || [],
    is_published: false,
  };

  const res = await axios.post(`${RC_BASE}/api/admin/articles`, body, {
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
  });

  return { id: res.data?.id, success: true };
}

// ─── Scraping bici.pro ────────────────────────────────────────────────────────
function scrapaBiciProOggi(): BiciProArticolo[] {
  const html = fetchPage(BIPRO_URL);
  if (html.startsWith("ERRORE")) return [];

  const $ = cheerio.load(html);
  const oggi = new Date().toISOString().split("T")[0];
  const articoli: BiciProArticolo[] = [];

  $("article, .post, .news-item, .entry, li.article").each((_, el) => {
    const $el = $(el);
    const link = $el.find("a[href]").first();
    const url = link.attr("href") || "";
    if (!url || !url.includes("bici.pro")) return;

    const titolo = (
      $el.find("h2, h3, .title, .entry-title").first().text() || link.text()
    ).trim();
    if (!titolo) return;

    const dateAttr =
      $el.find("time").attr("datetime") ||
      $el.find("[datetime]").attr("datetime") ||
      "";
    if (dateAttr.substring(0, 10) !== oggi) return;

    const testoLower = (titolo + url).toLowerCase();
    let categoria = "giovani";
    if (testoLower.includes("juniores") || testoLower.includes("junior"))
      categoria = "juniores";
    else if (testoLower.includes("allievi") || testoLower.includes("allievo"))
      categoria = "allievi";
    else if (testoLower.includes("under23") || testoLower.includes("u23"))
      categoria = "under23";
    else if (testoLower.includes("elite")) categoria = "elite";

    articoli.push({ titolo, url, data: oggi, testo: "", categoria });
  });

  return articoli;
}

// ─── Scraping federciclismo.it/strada ────────────────────────────────────────
function scrapaFciStradaOggi(): BiciProArticolo[] {
  const html = fetchPage(FCI_STRADA_URL);
  if (html.startsWith("ERRORE")) return [];

  const $ = cheerio.load(html);
  const oggi = new Date().toISOString().split("T")[0];
  const articoli: BiciProArticolo[] = [];

  $("article, .post, .news-item, .entry, .notizia, li.article, .card").each(
    (_, el) => {
      const $el = $(el);
      const link = $el.find("a[href]").first();
      let url = link.attr("href") || "";
      if (!url) return;
      if (!url.startsWith("http"))
        url = "https://www.federciclismo.it" + url;

      const titolo = (
        $el
          .find("h2, h3, h4, .title, .entry-title, .titolo")
          .first()
          .text() || link.text()
      ).trim();
      if (!titolo || titolo.length < 5) return;

      const dateAttr =
        $el.find("time").attr("datetime") ||
        $el.find("[datetime]").attr("datetime") ||
        "";
      if (dateAttr.substring(0, 10) !== oggi) return;

      const testoLower = (titolo + url).toLowerCase();
      let categoria = "giovani";
      if (testoLower.includes("juniores") || testoLower.includes("junior"))
        categoria = "juniores";
      else if (
        testoLower.includes("allievi") ||
        testoLower.includes("allievo")
      )
        categoria = "allievi";
      else if (testoLower.includes("under23") || testoLower.includes("u23"))
        categoria = "under23";
      else if (testoLower.includes("elite")) categoria = "elite";

      articoli.push({ titolo, url, data: oggi, testo: "", categoria });
    }
  );

  return articoli;
}

// ═════════════════════════════════════════════════════════════════════════════
// INNGEST FUNCTION PRINCIPALE
// ═════════════════════════════════════════════════════════════════════════════

export const fciWorkflowFn = inngest.createFunction(
  {
    id: "fci-workflow",
    name: "RadioCiclismo — Nazionali e Giovanili",
    concurrency: { limit: 1 },
  },
  { event: "cycling/generate.fci.article" },

  async ({ step }) => {
    const report: any[] = [];

    // ── Step 0: Login RC ─────────────────────────────────────────────────────
    const sessionCookie = await step.run("fci-login-rc", async () => {
      const cookie = await getSessionCookie();
      if (!cookie) throw new Error("Login RC fallito — cookie vuoto");
      return cookie;
    });

    // Reset cache gare RC — ogni run Inngest e fresh
    rcRacesCache = null;

    // ════════════════════════════════════════════════════════════════════════
    // PIPELINE A — Gare FCI dal DB (classifiche già caricate dal CSV worker)
    // ════════════════════════════════════════════════════════════════════════

    const gareOggi = await step.run("fci-fetch-gare-db", async () => {
      const gare = await getGareFCIOggi();
      console.log(`[FCI DB] Gare trovate oggi: ${gare.length}`);
      gare.forEach((g) =>
        console.log(`[FCI DB]  → "${g.title}" (${g.category}) — ${g.rankings.length} classificati`)
      );
      return gare;
    });

    for (const gara of gareOggi) {
      const garaReport: any = { nome: gara.title, fonte: "DB", azioni: [] };

      try {
        // A1 — Deduplicazione
        const giaPresente = await step.run(`fci-db-check-${gara.raceId}`, async () => {
          const exists = await isAlreadyPublished(gara.title, sessionCookie);
          console.log(`[FCI DB] "${gara.title}" già pubblicata: ${exists}`);
          return exists;
        });
        if (giaPresente) {
          garaReport.azioni.push("Già pubblicata — skippata");
          report.push(garaReport);
          continue;
        }

        // A2 — Incrocio con API races RC (verifica CSV worker)
        const rcMatch = await step.run(`fci-db-rc-match-${gara.raceId}`, async () => {
          // Passa fciRaceId per match deterministico prima del fuzzy
          const m = await incrociaCongRC(gara.title, sessionCookie, gara.fciRaceId);
          console.log(`[FCI DB] "${gara.title}" in RC: ${m.found}, hasResults: ${m.hasResults}`);
          return m;
        });

        // A3 — Arricchimento con Classifica RC Giovani
        const atletiArricchiti = await step.run(`fci-db-ranking-${gara.raceId}`, async () => {
          const categoriaRC = mapCategoriaToRCRanking(gara.category);
          const atleti = await arricchisciConClassificaRC(gara.rankings, categoriaRC);
          console.log(`[FCI DB] "${gara.title}" — ${atleti.filter(a => a.posizione).length}/${atleti.length} atleti in RC`);
          return atleti;
        });

        // A4 — Genera articolo IT
        const articoloIT = await step.run(`fci-db-genera-it-${gara.raceId}`, async () => {
          return await generaArticoloIT({
            titolo: gara.title,
            categoria: gara.category,
            data: gara.startDate,
            luogo: gara.location,
            classificaFormattata: formatClassificaPerPrompt(atletiArricchiti),
            vincitore: gara.rankings[0]?.name ?? null,
            intent: "report_finale", // dal DB arrivano sempre risultati definitivi
            garaInRC: rcMatch.found,
            rcHasResults: rcMatch.hasResults,
          });
        });

        // A5 — Genera traduzione EN
        const articoloEN = await step.run(`fci-db-genera-en-${gara.raceId}`, async () =>
          await generaArticoloEN(articoloIT.titolo, articoloIT.contenuto)
        );

        // A6 — Pubblica
        const pub = await step.run(`fci-db-pubblica-${gara.raceId}`, async () => {
          try {
            return await pubblicaArticolo(articoloIT, articoloEN, sessionCookie);
          } catch (err: any) {
            console.error("[FCI DB PUBBLICA] ❌", err.response?.status, JSON.stringify(err.response?.data));
            throw err;
          }
        });

        garaReport.azioni.push(`✅ Articolo creato — ID: ${pub.id}`);
        garaReport.azioni.push(`Atleti RC trovati: ${atletiArricchiti.filter(a => a.posizione).length}/${atletiArricchiti.length}`);
        garaReport.azioni.push(`Gara in RC: ${rcMatch.found ? "sì" : "no"} | Risultati CSV: ${rcMatch.hasResults ? "sì" : "no"}`);

      } catch (err: any) {
        garaReport.azioni.push(`❌ ERRORE: ${err.message}`);
        console.error(`[FCI DB] Errore su "${gara.title}":`, err.message);
      }

      report.push(garaReport);
    }

    // ════════════════════════════════════════════════════════════════════════
    // PIPELINE B — bici.pro (scraping)
    // ════════════════════════════════════════════════════════════════════════

    const articoliBiciPro = await step.run("bipro-fetch-lista", async () => {
      const lista = scrapaBiciProOggi();
      console.log(`[BICI.PRO] ${lista.length} articoli da processare oggi`);
      return lista;
    });

    for (const art of articoliBiciPro) {
      const key = slugify(art.url).substring(0, 40);
      const artReport: any = { nome: art.titolo, fonte: "bici.pro", azioni: [] };

      try {
        // B1 — Deduplicazione
        const giaPresente = await step.run(`bipro-check-${key}`, async () =>
          await isAlreadyPublished(art.titolo, sessionCookie)
        );
        if (giaPresente) {
          artReport.azioni.push("Già pubblicato — skippato");
          report.push(artReport);
          continue;
        }

        // B2 — Fetch testo completo
        const testo = await step.run(`bipro-testo-${key}`, async () => {
          const html = fetchPage(art.url);
          const t = estraiTesto(html);
          console.log(`[BICI.PRO] Testo per "${art.titolo}": ${t.length} char`);
          return t;
        });
        if (testo.length < 50) {
          artReport.azioni.push("Testo troppo corto — skippato");
          report.push(artReport);
          continue;
        }

        // B3 — Investigazione intento
        const investigazione = await step.run(`bipro-investiga-${key}`, async () => {
          const inv = await investigaArticolo(art.titolo, testo);
          console.log(`[BICI.PRO] "${art.titolo}" → intent: ${inv.intent}, vincitore: ${inv.vincitoreNominato}`);
          return inv;
        });
        artReport.azioni.push(`Intent rilevato: ${investigazione.intent}`);

        // B4 — Incrocio con RC races
        const rcMatch = await step.run(`bipro-rc-match-${key}`, async () =>
          await incrociaCongRC(investigazione.gareNominate[0] ?? art.titolo, sessionCookie)
        );

        // B5 — Atleti in classifica RC (ricerca per cognome nel testo)
        const atletiRC = await step.run(`bipro-ranking-${key}`, async () =>
          await cercaAtletiInTesto(testo, mapCategoriaToRCRanking(art.categoria))
        );

        // B6 — Genera IT
        const articoloIT = await step.run(`bipro-genera-it-${key}`, async () =>
          await generaArticoloIT({
            titolo: art.titolo,
            categoria: art.categoria,
            data: art.data,
            luogo: "",
            testo,
            classificaFormattata: formatClassificaPerPrompt(atletiRC),
            vincitore: investigazione.vincitoreNominato,
            intent: investigazione.intent,
            garaInRC: rcMatch.found,
            rcHasResults: rcMatch.hasResults,
          })
        );

        // B7 — Genera EN
        const articoloEN = await step.run(`bipro-genera-en-${key}`, async () =>
          await generaArticoloEN(articoloIT.titolo, articoloIT.contenuto)
        );

        // B8 — Pubblica (slug con timestamp per unicità)
        articoloIT.slug = `${articoloIT.slug}-${Date.now()}`;
        const pub = await step.run(`bipro-pubblica-${key}`, async () => {
          try {
            return await pubblicaArticolo(articoloIT, articoloEN, sessionCookie);
          } catch (err: any) {
            console.error("[BICI.PRO PUBBLICA] ❌", err.response?.status, JSON.stringify(err.response?.data));
            throw err;
          }
        });

        artReport.azioni.push(`✅ Articolo creato — ID: ${pub.id}`);
        artReport.azioni.push(`Gara in RC: ${rcMatch.found ? "sì" : "no"} | Atleti RC: ${atletiRC.length}`);

      } catch (err: any) {
        artReport.azioni.push(`❌ ERRORE: ${err.message}`);
        console.error(`[BICI.PRO] Errore su "${art.titolo}":`, err.message);
      }

      report.push(artReport);
    }

    // ════════════════════════════════════════════════════════════════════════
    // PIPELINE C — federciclismo.it/strada (scraping)
    // ════════════════════════════════════════════════════════════════════════

    const articoliFciStrada = await step.run("fci-strada-fetch-lista", async () => {
      const lista = scrapaFciStradaOggi();
      console.log(`[FCI STRADA] ${lista.length} articoli da processare oggi`);
      return lista;
    });

    for (const art of articoliFciStrada) {
      const key = slugify(art.url).substring(0, 40);
      const artReport: any = { nome: art.titolo, fonte: "federciclismo.it/strada", azioni: [] };

      try {
        // C1 — Deduplicazione
        const giaPresente = await step.run(`fci-strada-check-${key}`, async () =>
          await isAlreadyPublished(art.titolo, sessionCookie)
        );
        if (giaPresente) {
          artReport.azioni.push("Già pubblicato — skippato");
          report.push(artReport);
          continue;
        }

        // C2 — Fetch testo
        const testo = await step.run(`fci-strada-testo-${key}`, async () => {
          const html = fetchPage(art.url);
          const t = estraiTesto(html);
          console.log(`[FCI STRADA] Testo per "${art.titolo}": ${t.length} char`);
          return t;
        });
        if (testo.length < 50) {
          artReport.azioni.push("Testo troppo corto — skippato");
          report.push(artReport);
          continue;
        }

        // C3 — Investigazione intento
        const investigazione = await step.run(`fci-strada-investiga-${key}`, async () => {
          const inv = await investigaArticolo(art.titolo, testo);
          console.log(`[FCI STRADA] "${art.titolo}" → intent: ${inv.intent}`);
          return inv;
        });
        artReport.azioni.push(`Intent rilevato: ${investigazione.intent}`);

        // C4 — Incrocio RC
        const rcMatch = await step.run(`fci-strada-rc-match-${key}`, async () =>
          await incrociaCongRC(investigazione.gareNominate[0] ?? art.titolo, sessionCookie)
        );

        // C5 — Atleti RC
        const atletiRC = await step.run(`fci-strada-ranking-${key}`, async () =>
          await cercaAtletiInTesto(testo, mapCategoriaToRCRanking(art.categoria))
        );

        // C6 — Genera IT
        const articoloIT = await step.run(`fci-strada-genera-it-${key}`, async () =>
          await generaArticoloIT({
            titolo: art.titolo,
            categoria: art.categoria,
            data: art.data,
            luogo: "",
            testo,
            classificaFormattata: formatClassificaPerPrompt(atletiRC),
            vincitore: investigazione.vincitoreNominato,
            intent: investigazione.intent,
            garaInRC: rcMatch.found,
            rcHasResults: rcMatch.hasResults,
          })
        );

        // C7 — Genera EN
        const articoloEN = await step.run(`fci-strada-genera-en-${key}`, async () =>
          await generaArticoloEN(articoloIT.titolo, articoloIT.contenuto)
        );

        // C8 — Pubblica
        articoloIT.slug = `${articoloIT.slug}-${Date.now()}`;
        const pub = await step.run(`fci-strada-pubblica-${key}`, async () => {
          try {
            return await pubblicaArticolo(articoloIT, articoloEN, sessionCookie);
          } catch (err: any) {
            console.error("[FCI STRADA PUBBLICA] ❌", err.response?.status, JSON.stringify(err.response?.data));
            throw new Error(`RC ha risposto ${err.response?.status}: ${JSON.stringify(err.response?.data)}`);
          }
        });

        artReport.azioni.push(`✅ Articolo creato — ID: ${pub.id}`);
        artReport.azioni.push(`Gara in RC: ${rcMatch.found ? "sì" : "no"} | Atleti RC: ${atletiRC.length}`);

      } catch (err: any) {
        artReport.azioni.push(`❌ ERRORE: ${err.message}`);
        console.error(`[FCI STRADA] Errore su "${art.titolo}":`, err.message);
      }

      report.push(artReport);
    }

    // ── Report finale ─────────────────────────────────────────────────────────
    return {
      success: true,
      gareDB: gareOggi.length,
      articoliBiciPro: articoliBiciPro.length,
      articoliFciStrada: articoliFciStrada.length,
      report,
    };
  }
);
