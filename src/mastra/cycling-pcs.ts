/**
 * cycling-pcs.ts  →  src/mastra/cycling-pcs.ts
 * RadioCiclismo — Gare Internazionali (ProcyclingStats)
 *
 * Architettura:
 *  - cyclingDispatchFn: legge il calendario PCS di oggi, fa login RC una volta,
 *    e dispatcha un evento per ogni gara con vincitore
 *  - cyclingProcessRaceFn: per ogni gara → narrativa + risultati tecnici →
 *    genera articolo IT + EN con Anthropic → pubblica su RC (bozza, +2h)
 */

import { inngest } from "../client.js";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";
const PCS_BASE = "https://www.procyclingstats.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const MODEL = anthropic("claude-sonnet-4-20250514");

// ─── Slugify ──────────────────────────────────────────────────────────────────
const slugify = (t: string) =>
  t
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .substring(0, 80);

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

// ─── Narrativa esterna da cyclingpro.net (contesto extra per l'AI) ────────────
async function fetchRaceNarrative(raceName: string): Promise<string> {
  try {
    const searchUrl = `https://cyclingpro.net/spaziociclismo/?s=${encodeURIComponent(raceName)}`;
    const html = execSync(
      `curl -s -L --max-time 15 -H "User-Agent: ${UA}" "${searchUrl}"`
    ).toString();
    const $ = cheerio.load(html);
    const firstUrl = $("article h2 a").first().attr("href");
    if (!firstUrl) return "";

    const artHtml = execSync(
      `curl -s -L --max-time 15 -H "User-Agent: ${UA}" "${firstUrl}"`
    ).toString();
    const $art = cheerio.load(artHtml);
    return $art(".entry-content p").slice(0, 5).text().trim().substring(0, 1500);
  } catch {
    return "";
  }
}

// ─── Risultati tecnici da PCS ─────────────────────────────────────────────────
function fetchPCSResults(raceUrl: string): Array<{
  pos: string;
  rider: string;
  team: string;
  time: string;
}> {
  try {
    const html = execSync(
      `curl -s -L --max-time 20 -H "User-Agent: ${UA}" "${PCS_BASE}/${raceUrl}"`
    ).toString();
    const $ = cheerio.load(html);
    const rows: any[] = [];

    $("table.results tbody tr, .result-cont tr").slice(0, 10).each((_, el) => {
      const pos = $(el).find("td").first().text().trim();
      const rider = $(el).find("a[href*='rider/']").text().trim();
      const team = $(el).find("a[href*='team/']").text().trim();
      const time = $(el).find(".time, td.time").text().trim();
      if (rider) rows.push({ pos, rider, team, time });
    });

    return rows;
  } catch {
    return [];
  }
}

// ─── Genera articolo IT ───────────────────────────────────────────────────────
async function generaArticoloIT(params: {
  nome: string;
  vincitore: string;
  risultati: Array<{ pos: string; rider: string; team: string; time: string }>;
  narrativa: string;
}) {
  const anno = new Date().getFullYear();

  const result = await generateObject({
    model: MODEL,
    prompt: `Sei il "Radiociclismo Reporter", giornalista sportivo specializzato in ciclismo internazionale.

════════════════════════════════
REGOLE ASSOLUTE
════════════════════════════════
1. Usa SOLO i dati forniti. Zero invenzioni.
2. MAI placeholder come [SQUADRA] o [DISTACCO].
3. Se un dato manca, omettilo — non inventarlo.
4. Stile: epico ma tecnico, appassionante, da grande giornalismo sportivo.
5. FALLBACK: se i dati sono scarsi, usa stile FLASH NEWS — fatti diretti.

════════════════════════════════
DATI GARA
════════════════════════════════
Gara: ${params.nome}
Anno: ${anno}
Vincitore: ${params.vincitore}

Top 10:
${params.risultati.map((r) => `${r.pos}. ${r.rider} (${r.team}) ${r.time}`).join("\n") || "Dati non disponibili"}

Contesto narrativo esterno:
${params.narrativa || "Nessun contesto aggiuntivo disponibile."}

════════════════════════════════
STRUTTURA
════════════════════════════════
1. APERTURA: chi ha vinto, come, dove — colpo di scena o dominio?
2. GARA: fasi decisive, tattica, momenti chiave dai dati disponibili.
3. TOP 5: classifica con squadre e distacchi.
4. CHIUSURA: significato del risultato per la stagione ${anno}.

Lunghezza: 250-350 parole. Titolo: coinvolgente con nome gara e vincitore.
Slug: kebab-case nome-gara-anno. Tags: 3 tag (nome gara, vincitore, categoria).`,
    schema: z.object({
      titolo: z.string(),
      excerpt: z.string(),
      contenuto: z.string(),
      metaDescription: z.string(),
      slug: z.string(),
      tags: z.array(z.string()),
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

// ─── Pubblica su RC ───────────────────────────────────────────────────────────
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
    author: "Radiociclismo Reporter",
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

// ═════════════════════════════════════════════════════════════════════════════
// DISPATCHER — legge calendario PCS e dispatcha un evento per gara
// ═════════════════════════════════════════════════════════════════════════════

export const cyclingDispatchFn = inngest.createFunction(
  {
    id: "cycling-dispatch",
    name: "RadioCiclismo — PCS Dispatcher",
  },
  { event: "cycling/generate.article" },

  async ({ step }) => {
    // Login una volta sola — il cookie viene passato ai worker nel payload
    const sessionCookie = await step.run("pcs-login-rc", async () => {
      const cookie = await getSessionCookie();
      if (!cookie) throw new Error("Login RC fallito");
      return cookie;
    });

    // Leggi calendario PCS di oggi E ieri (copertura gare finite tardi)
    const gareOggi = await step.run("pcs-fetch-calendar", async () => {
      const oggi = new Date();
      const ieri = new Date(oggi);
      ieri.setDate(ieri.getDate() - 1);

      const dateOggi = oggi.toISOString().split("T")[0];
      const dateIeri = ieri.toISOString().split("T")[0];

      const fetchGare = (date: string): Array<{ name: string; url: string; winner: string }> => {
        try {
          const cmd = `curl -s -L --http2 --max-time 20 -H "User-Agent: ${UA}" "${PCS_BASE}/races.php?date=${date}"`;
          const html = execSync(cmd).toString();
          const $ = cheerio.load(html);
          const results: Array<{ name: string; url: string; winner: string }> = [];

          $("table.basic tr").each((_, el) => {
            const link = $(el).find("a[href*=\'race/\']");
            const name = link.text().trim();
            const href = link.attr("href") ?? "";
            const winner = $(el).find("a[href*=\'rider/\']").last().text().trim();
            if (name && href && winner) {
              results.push({ name, url: href.replace(/^\//, ""), winner });
            }
          });

          console.log(`[PCS DISPATCH] ${date}: ${results.length} gare trovate`);
          return results;
        } catch (e: any) {
          console.error(`[PCS DISPATCH] Fetch ${date} fallito:`, e.message);
          return [];
        }
      };

      const gareOggiRaw = fetchGare(dateOggi);
      const gareIeriRaw = fetchGare(dateIeri);

      // Deduplicazione per URL — ieri ha priorità se già presente
      const seen = new Set<string>();
      const merged: Array<{ name: string; url: string; winner: string }> = [];
      for (const g of [...gareOggiRaw, ...gareIeriRaw]) {
        if (!seen.has(g.url)) {
          seen.add(g.url);
          merged.push(g);
        }
      }

      console.log(`[PCS DISPATCH] Totale gare da processare: ${merged.length}`);
      return merged;
    });

    if (!gareOggi.length) {
      return { dispatched: 0, message: "Nessuna gara con risultati oggi/ieri su PCS" };
    }

    // Dispatcha un evento per ogni gara — Inngest gestisce i fallimenti individualmente
    const events = gareOggi.map((gara) => ({
      name: "cycling/process.single.race" as const,
      data: { gara, sessionCookie },
    }));

    await step.sendEvent("pcs-dispatch-workers", events);

    return { dispatched: events.length };
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// WORKER — processa una singola gara PCS
// ═════════════════════════════════════════════════════════════════════════════

export const cyclingProcessRaceFn = inngest.createFunction(
  {
    id: "cycling-worker",
    name: "RadioCiclismo — PCS Worker",
    concurrency: { limit: 2 }, // max 2 gare in parallelo
    retries: 2,
  },
  { event: "cycling/process.single.race" },

  async ({ event, step }) => {
    const { gara, sessionCookie } = event.data;
    if (!gara || !gara.name || !gara.url || !gara.winner) {
      console.error("[PCS WORKER] Payload non valido:", JSON.stringify(event.data));
      return { status: "error", reason: "payload_invalid" };
    }


    // W1 — Deduplicazione (evita di riprocessare se già pubblicato)
    const giaPresente = await step.run("pcs-check-dup", async () => {
      return await isAlreadyPublished(gara.name, sessionCookie);
    });

    if (giaPresente) {
      console.log(`[PCS WORKER] "${gara.name}" già pubblicata — skip`);
      return { status: "skipped", race: gara.name };
    }

    // W2 — Narrativa esterna (cyclingpro.net) — fallback silenzioso se non disponibile
    const narrativa = await step.run("pcs-get-narrative", async () => {
      const n = await fetchRaceNarrative(gara.name);
      console.log(`[PCS WORKER] Narrativa per "${gara.name}": ${n.length} char`);
      return n;
    });

    // W3 — Risultati tecnici da PCS
    const risultati = await step.run("pcs-get-results", async () => {
      const rows = fetchPCSResults(gara.url);
      console.log(`[PCS WORKER] Risultati per "${gara.name}": ${rows.length} righe`);
      return rows;
    });

    // W4 — Protezione: se non abbiamo né narrativa né risultati, skippa
    if (!narrativa && risultati.length === 0) {
      console.log(`[PCS WORKER] "${gara.name}" — dati insufficienti, SKIP`);
      return { status: "skipped_no_data", race: gara.name };
    }

    // W5 — Genera articolo IT
    const articoloIT = await step.run("pcs-genera-it", async () => {
      return await generaArticoloIT({
        nome: gara.name,
        vincitore: gara.winner,
        risultati,
        narrativa,
      });
    });

    // Protezione contenuto minimo (guard anti-output AI degradato)
    if (!articoloIT.contenuto || articoloIT.contenuto.length < 200) {
      console.log(`[PCS WORKER] "${gara.name}" — contenuto AI troppo corto, SKIP`);
      return { status: "skipped_short_content", race: gara.name };
    }

    // W6 — Genera traduzione EN
    const articoloEN = await step.run("pcs-genera-en", async () => {
      return await generaArticoloEN(articoloIT.titolo, articoloIT.contenuto);
    });

    // W7 — Pubblica su RC
    const pub = await step.run("pcs-pubblica", async () => {
      // Slug con timestamp per unicità assoluta tra gare diverse
      articoloIT.slug = `${articoloIT.slug}-${Date.now()}`;
      try {
        return await pubblicaArticolo(articoloIT, articoloEN, sessionCookie);
      } catch (err: any) {
        console.error(
          "[PCS PUBBLICA] ❌",
          err.response?.status,
          JSON.stringify(err.response?.data)
        );
        throw err;
      }
    });

    console.log(`[PCS WORKER] ✅ "${gara.name}" — ID: ${pub.id}`);
    return { status: "success", race: gara.name, articleId: pub.id };
  }
);
