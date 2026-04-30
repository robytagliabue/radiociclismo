/**
 * rcUtils.ts  →  src/mastra/rcUtils.ts
 * Utility condivise tra cycling-fci.ts e cycling-pcs.ts
 *
 * - fetchRCRaces: carica tutte le gare approvate da RC (con cache in-memory)
 * - incrociaCongRC: fuzzy match gara PCS/FCI → gara RC
 * - markArticleGenerated: marca una gara RC come già articolata
 * - isAlreadyPublished: deduplicazione articoli per slug gara (non titolo AI)
 */

import axios from "axios";

const RC_BASE = "https://radiociclismo.com";

// ─── Tipi ─────────────────────────────────────────────────────────────────────
export interface RCRace {
  id: number;
  slug: string;
  title: string;
  category: string;
  gender: string;
  startDate: string;
  state: "upcoming" | "in_progress" | "archived";
  status: "pending" | "approved" | "rejected";
  fciRaceId: string | null;
  uciRaceId: string | null;
  region: string | null;
  articleGeneratedAt: string | null;
  articleRcId: number | null;
}

export interface RCMatchResult {
  found: boolean;
  raceId?: number;
  slug?: string;
  hasResults: boolean;
  alreadyHasArticle: boolean;
  race?: RCRace;
}

// ─── Cache in-memory (resettata a ogni run Inngest) ───────────────────────────
let rcRacesCache: RCRace[] | null = null;

export function resetRCRacesCache() {
  rcRacesCache = null;
}

// ─── Fetch tutte le gare approvate da RC ──────────────────────────────────────
export async function fetchRCRaces(cookie: string): Promise<RCRace[]> {
  if (rcRacesCache) return rcRacesCache;
  try {
    const res = await axios.get(
      `${RC_BASE}/api/admin/races?status=approved`,
      { headers: { Cookie: cookie } }
    );
    rcRacesCache = Array.isArray(res.data) ? res.data : [];
    console.log(`[RC RACES] Caricate ${rcRacesCache!.length} gare approvate`);
    return rcRacesCache!;
  } catch (e: any) {
    console.error("[RC RACES] Fetch fallito:", e.message);
    return [];
  }
}

// ─── Levenshtein ──────────────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function normalizzaTitolo(t: string): string {
  return t
    .toLowerCase()
    // Rimuovi anno, "stage N", "results", "classifica generale"
    .replace(/\b(20\d{2}|stage\s*\d+|results?|classifica\s*generale\s*(finale)?)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Incrocio gara esterna → gara RC ─────────────────────────────────────────
// Strategia:
//  1. Match deterministico per fciRaceId (solo FCI)
//  2. Match per parole chiave (≥ 70% parole in comune) — come lo scraper PCS
//  3. Fallback Levenshtein con soglia 70%
export async function incrociaCongRC(
  nomeGara: string,
  cookie: string,
  fciRaceId?: string | null
): Promise<RCMatchResult> {
  const races = await fetchRCRaces(cookie);
  if (!races.length) return { found: false, hasResults: false, alreadyHasArticle: false };

  // 1. Match deterministico per fciRaceId
  if (fciRaceId) {
    const exact = races.find(r => r.fciRaceId === fciRaceId);
    if (exact) {
      console.log(`[RC MATCH] fciRaceId="${fciRaceId}" → "${exact.title}"`);
      return {
        found: true,
        raceId: exact.id,
        slug: exact.slug,
        hasResults: exact.state === "archived",
        alreadyHasArticle: !!exact.articleGeneratedAt,
        race: exact,
      };
    }
  }

  // 2. Match per parole chiave (logica scraper PCS)
  const nomeNorm = normalizzaTitolo(nomeGara);
  const paroleNome = nomeNorm.split(" ").filter(p => p.length >= 3);

  let bestKeywordMatch: RCRace | null = null;
  let bestKeywordScore = 0;

  for (const race of races) {
    const raceNorm = normalizzaTitolo(race.title);
    if (!paroleNome.length) break;
    const paroleMatch = paroleNome.filter(p => raceNorm.includes(p)).length;
    const score = paroleMatch / paroleNome.length;
    if (score > bestKeywordScore) {
      bestKeywordScore = score;
      bestKeywordMatch = race;
    }
  }

  if (bestKeywordMatch && bestKeywordScore >= 0.7) {
    console.log(`[RC MATCH] Keyword "${nomeGara}" → "${bestKeywordMatch.title}" (score: ${bestKeywordScore.toFixed(2)})`);
    return {
      found: true,
      raceId: bestKeywordMatch.id,
      slug: bestKeywordMatch.slug,
      hasResults: bestKeywordMatch.state === "archived",
      alreadyHasArticle: !!bestKeywordMatch.articleGeneratedAt,
      race: bestKeywordMatch,
    };
  }

  // 3. Fallback Levenshtein
  let bestLevMatch: RCRace | null = null;
  let bestLevScore = Infinity;

  for (const race of races) {
    const raceNorm = normalizzaTitolo(race.title);
    if (raceNorm.includes(nomeNorm) || nomeNorm.includes(raceNorm)) {
      bestLevMatch = race;
      bestLevScore = 0;
      break;
    }
    const dist = levenshtein(nomeNorm, raceNorm);
    const score = dist / Math.max(nomeNorm.length, raceNorm.length);
    if (score < bestLevScore) {
      bestLevScore = score;
      bestLevMatch = race;
    }
  }

  if (bestLevMatch && bestLevScore < 0.3) {
    console.log(`[RC MATCH] Levenshtein "${nomeGara}" → "${bestLevMatch.title}" (score: ${bestLevScore.toFixed(2)})`);
    return {
      found: true,
      raceId: bestLevMatch.id,
      slug: bestLevMatch.slug,
      hasResults: bestLevMatch.state === "archived",
      alreadyHasArticle: !!bestLevMatch.articleGeneratedAt,
      race: bestLevMatch,
    };
  }

  console.log(`[RC MATCH] Nessun match per "${nomeGara}"`);
  return { found: false, hasResults: false, alreadyHasArticle: false };
}

// ─── Marca gara come articolo generato ───────────────────────────────────────
// Non bloccante — logga ma non interrompe il workflow se fallisce
export async function markArticleGenerated(
  raceId: number,
  articleId: string | number,
  cookie: string
): Promise<void> {
  try {
    await axios.patch(
      `${RC_BASE}/api/admin/races/${raceId}/mark-article-generated`,
      { articleId },
      { headers: { "Content-Type": "application/json", Cookie: cookie } }
    );
    console.log(`[RC] Gara ${raceId} marcata — articleId: ${articleId}`);
  } catch (e: any) {
    console.error(`[RC] mark-article-generated fallito per gara ${raceId}:`, e.message);
  }
}

// ─── Deduplicazione per slug gara RC ─────────────────────────────────────────
// Più affidabile del match per titolo AI (che cambia ad ogni generazione).
// Cerca articoli che contengono lo slug della gara negli hashtags.
export async function isArticleExistsForRace(
  raceSlug: string,
  cookie: string
): Promise<boolean> {
  try {
    const res = await axios.get(
      `${RC_BASE}/api/admin/articles?search=${encodeURIComponent(raceSlug)}&limit=5`,
      { headers: { Cookie: cookie } }
    );
    const articles = res.data?.articles ?? res.data ?? [];
    return articles.some((a: any) =>
      (a.hashtags ?? []).includes(`race-${raceSlug}`) ||
      a.slug?.includes(raceSlug)
    );
  } catch {
    return false;
  }
}

// ─── Deduplicazione generica per titolo (fallback) ───────────────────────────
export async function isAlreadyPublished(
  titolo: string,
  cookie: string
): Promise<boolean> {
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
