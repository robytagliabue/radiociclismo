import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchWithFetch(url: string, timeoutMs: number = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    return await resp.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

interface ArticleCandidate {
  url: string;
  text: string;
  score: number;
  source: string;
}

// Words too generic to be meaningful for race identification
const GENERIC_RACE_WORDS = new Set([
  "stage", "results", "risultati", "tappa", "race", "gara", "classic", "classica",
  "van", "von", "del", "dei", "des", "les", "las", "los", "der", "den", "het",
  "one", "two", "tre", "the", "and", "per", "par", "sur", "con", "pro",
  "men", "women", "elite", "junior", "juniores", "under",
]);

function buildRaceSearchTerms(raceName: string, winner: string) {
  const raceNameLower = raceName.toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[–—]/g, "-");
  // Exclude: years (4-digit numbers), words <3 chars, and generic words
  const raceWords = raceNameLower.split(/[\s\-\/]+/).filter(w =>
    w.length >= 3 && !/^\d{4}$/.test(w) && !GENERIC_RACE_WORDS.has(w)
  );
  // PCS format: "SURNAME Firstname" → take first meaningful part as surname, normalized to ASCII
  const normalizeAscii = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const winnerParts = normalizeAscii(winner).split(/\s+/).filter(w => w.length >= 3);
  const winnerSurname = winnerParts.length > 0 ? winnerParts[0] : "";
  const stageMatch = raceName.match(/stage[- ]?(\d+)/i) || raceName.match(/tappa[- ]?(\d+)/i);
  const stageNum = stageMatch ? stageMatch[1] : "";
  return { raceWords, winnerSurname, stageNum };
}

function scoreCandidate(urlSlug: string, text: string, raceWords: string[], winnerSurname: string, stageNum: string): number {
  // Distinctive words: length >= 5 (raceWords already excludes generic ones)
  const distinctiveWords = raceWords.filter(w => w.length >= 5);

  // If race has distinctive words, require at least ONE to match — prevents false positives
  if (distinctiveWords.length > 0) {
    const anyDistinctiveMatch = distinctiveWords.some(w => urlSlug.includes(w) || text.toLowerCase().includes(w));
    if (!anyDistinctiveMatch) return 0;
  }

  let score = 0;
  for (const word of raceWords) {
    if (urlSlug.includes(word) || text.toLowerCase().includes(word)) score += 2;
  }
  if (winnerSurname && (urlSlug.includes(winnerSurname) || text.toLowerCase().includes(winnerSurname))) {
    score += 5;
  }
  if (stageNum) {
    if (urlSlug.includes(`stage-${stageNum}`) || urlSlug.includes(`stage${stageNum}`) || urlSlug.includes(`tappa-${stageNum}`) || urlSlug.includes(`tappa${stageNum}`)) {
      score += 3;
    }
  }
  return score;
}

function extractArticleText(html: string): string[] {
  const a$ = cheerio.load(html);
  const paragraphs: string[] = [];
  a$("p").each((_i, el) => {
    const text = a$(el).text().trim()
      .replace(/&#\d+;/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ");
    if (
      text.length > 40 &&
      !text.includes("cookie") &&
      !text.includes("privacy") &&
      !text.includes("affiliate") &&
      !text.includes("Newsletter") &&
      !text.includes("submitting your information") &&
      !text.includes("Terms & Conditions") &&
      !text.includes("purchase through links") &&
      !text.includes("indirizzo email") &&
      !text.includes("campi obbligatori") &&
      !text.includes("prossima volta che commento")
    ) {
      paragraphs.push(text);
    }
  });
  return paragraphs;
}

async function searchCyclingNews(raceWords: string[], winnerSurname: string, stageNum: string, logger?: any): Promise<ArticleCandidate[]> {
  const candidates: ArticleCandidate[] = [];
  try {
    const html = await fetchWithFetch("https://www.cyclingnews.com/race-results/", 20000);
    if (html.includes("Just a moment") || html.includes("cf-browser-verification")) {
      logger?.warn("⚠️ [CyclingNews] Blocked by Cloudflare");
      return [];
    }
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    $("a[href*='/pro-cycling/racing/'], a[href*='/pro-cycling/races/'], a[href*='/pro-cycling/womens-cycling/']").each((_i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim().toLowerCase();
      const fullUrl = href.startsWith("http") ? href : `https://www.cyclingnews.com${href}`;
      if (!fullUrl.includes("/racing/") && !fullUrl.includes("/races/") && !fullUrl.includes("/womens-cycling/")) return;
      if (fullUrl.endsWith("/racing/") || fullUrl.endsWith("/races/") || fullUrl.endsWith("/womens-cycling/")) return;
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);
      const urlSlug = fullUrl.split("/").pop() || "";
      const score = scoreCandidate(urlSlug, text, raceWords, winnerSurname, stageNum);
      if (score >= 4) {
        candidates.push({ url: fullUrl, text, score, source: "CyclingNews" });
      }
    });
  } catch (err: any) {
    logger?.warn(`⚠️ [CyclingNews] Error searching: ${err.message}`);
  }
  return candidates;
}

async function searchCyclingPro(raceWords: string[], winnerSurname: string, stageNum: string, logger?: any): Promise<ArticleCandidate[]> {
  const candidates: ArticleCandidate[] = [];
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
    const dailyUrl = `https://cyclingpro.net/spaziociclismo/${dateStr}/`;
    logger?.info(`📰 [CyclingPro] Fetching daily archive: ${dailyUrl}`);
    const html = await fetchWithFetch(dailyUrl, 20000);
    if (html.includes("Just a moment") || html.includes("cf-browser-verification")) {
      logger?.warn("⚠️ [CyclingPro] Blocked by Cloudflare");
      return [];
    }
    const $ = cheerio.load(html);
    const articleCategories = ["sintesi-gare", "continental", "worldtour", "pro-cycling", "professional"];
    $("a[href*='cyclingpro.net/spaziociclismo/']").each((_i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim().toLowerCase();
      if (!href.startsWith("http")) return;
      const pathParts = href.replace("https://cyclingpro.net/spaziociclismo/", "").split("/").filter(Boolean);
      if (pathParts.length < 2) return;
      const category = pathParts[0];
      if (!articleCategories.includes(category)) return;
      const urlSlug = pathParts[pathParts.length - 1] || "";
      const score = scoreCandidate(urlSlug, text, raceWords, winnerSurname, stageNum);
      if (category === "sintesi-gare") {
        if (score >= 3) {
          candidates.push({ url: href, text, score: score + 2, source: "CyclingPro" });
        }
      } else if (score >= 4) {
        candidates.push({ url: href, text, score, source: "CyclingPro" });
      }
    });
  } catch (err: any) {
    logger?.warn(`⚠️ [CyclingPro] Error searching: ${err.message}`);
  }
  return candidates;
}

export async function fetchRaceNarrative(raceName: string, winner: string, logger?: any): Promise<string> {
  logger?.info(`📰 [fetchRaceNarrative] Searching for race narrative: "${raceName}" (winner: ${winner})`);

  const { raceWords, winnerSurname, stageNum } = buildRaceSearchTerms(raceName, winner);
  logger?.info(`📰 [fetchRaceNarrative] Race words: [${raceWords.join(", ")}], winner surname: "${winnerSurname}"${stageNum ? `, stage: ${stageNum}` : ""}`);

  // Primary: Italian sites (CyclingPro/SpazioCiclismo) — faster and preferred for Italian editorial
  const cpCandidates = await searchCyclingPro(raceWords, winnerSurname, stageNum, logger);

  // Fallback: CyclingNews — only if Italian sites found nothing
  let cnCandidates: ArticleCandidate[] = [];
  if (cpCandidates.length === 0) {
    logger?.info("📰 [fetchRaceNarrative] No Italian candidates — trying CyclingNews as fallback");
    cnCandidates = await searchCyclingNews(raceWords, winnerSurname, stageNum, logger);
  }

  const allCandidates = [...cpCandidates, ...cnCandidates].sort((a, b) => b.score - a.score);

  const uniqueCandidates: ArticleCandidate[] = [];
  const seenUrls = new Set<string>();
  for (const c of allCandidates) {
    if (!seenUrls.has(c.url)) {
      seenUrls.add(c.url);
      uniqueCandidates.push(c);
    }
  }

  logger?.info(`📰 [fetchRaceNarrative] Found ${cpCandidates.length} CyclingPro + ${cnCandidates.length} CyclingNews candidate(s) = ${uniqueCandidates.length} unique`);
  for (const c of uniqueCandidates.slice(0, 5)) {
    logger?.info(`  → Score ${c.score} [${c.source}]: ${c.url}`);
  }

  if (uniqueCandidates.length === 0) {
    logger?.info("📰 [fetchRaceNarrative] No matching articles found on any source");
    return "";
  }

  for (const candidate of uniqueCandidates.slice(0, 3)) {
    try {
      logger?.info(`📰 [fetchRaceNarrative] Fetching [${candidate.source}]: ${candidate.url}`);
      const articleHtml = await fetchWithFetch(candidate.url, 20000);
      if (articleHtml.includes("Just a moment")) {
        logger?.warn(`⚠️ [fetchRaceNarrative] ${candidate.source} article blocked by Cloudflare`);
        continue;
      }

      const paragraphs = extractArticleText(articleHtml);
      const narrative = paragraphs.join("\n\n");
      if (narrative.length < 200) {
        logger?.info(`📰 [fetchRaceNarrative] Too short (${narrative.length} chars, ${paragraphs.length} paragraphs) from ${candidate.source}, trying next`);
        continue;
      }

      const truncated = narrative.length > 5000 ? narrative.substring(0, 5000) + "..." : narrative;

      logger?.info(`📰 [fetchRaceNarrative] ✅ Extracted ${paragraphs.length} paragraphs (${truncated.length} chars) from ${candidate.source}`);
      return `[Source: ${candidate.source}]\n${truncated}`;
    } catch (err: any) {
      logger?.warn(`⚠️ [fetchRaceNarrative] Error fetching ${candidate.source} article: ${err.message}`);
    }
  }

  logger?.info("📰 [fetchRaceNarrative] Could not extract text from any candidate article");
  return "";
}

function fetchWithCurl(url: string, timeoutMs: number = 20000): string {
  try {
    return execSync(
      `curl -s -L "${url}" -H "User-Agent: ${UA}" -H "Accept: text/html"`,
      { timeout: timeoutMs, encoding: "utf8" },
    );
  } catch (curlError: any) {
    if (curlError.message?.includes("ENOENT") || curlError.message?.includes("not found")) {
      throw new Error("CURL_NOT_AVAILABLE");
    }
    throw curlError;
  }
}

async function fetchPage(url: string, timeoutMs: number = 20000, logger?: any): Promise<string> {
  try {
    return fetchWithCurl(url, timeoutMs);
  } catch (err: any) {
    if (err.message === "CURL_NOT_AVAILABLE") {
      logger?.warn("⚠️ [fetchPage] curl not available, falling back to fetch() - Cloudflare may block this");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, {
          headers: { "User-Agent": UA, "Accept": "text/html" },
          signal: controller.signal,
          redirect: "follow",
        });
        clearTimeout(timer);
        const html = await resp.text();
        if (html.includes("Just a moment") || html.includes("cf-browser-verification") || html.includes("_cf_chl_opt")) {
          logger?.warn("⚠️ [fetchPage] Cloudflare challenge detected in fetch() response - page content unavailable");
        }
        return html;
      } catch (fetchErr) {
        clearTimeout(timer);
        throw fetchErr;
      }
    }
    throw err;
  }
}

export const webSearchRacesTool = createTool({
  id: "web-search-races",
  description:
    "Fetches today's completed cycling race results from ProCyclingStats using curl to bypass Cloudflare.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    found: z.boolean(),
    searchResults: z.string(),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const dayNum = String(today.getDate()).padStart(2, "0");
    const monthNum = String(today.getMonth() + 1).padStart(2, "0");
    const todayDotFormat = `${dayNum}.${monthNum}`;

    logger?.info(`🔍 [webSearchRaces] Searching PCS for races on ${dateStr} (${todayDotFormat})...`);

    try {
      const calendarUrl = `https://www.procyclingstats.com/races.php?date=${dateStr}&circuit=&class=&filter=Filter`;

      logger?.info(`🔗 [webSearchRaces] Fetching calendar: ${calendarUrl}`);

      const calendarHtml = await fetchPage(calendarUrl, 30000, logger);

      if (calendarHtml.includes("Just a moment") || calendarHtml.includes("cf-browser-verification")) {
        logger?.warn("⚠️ [webSearchRaces] Cloudflare challenge detected on calendar page");
        return { found: false, searchResults: "" };
      }

      const $ = cheerio.load(calendarHtml);

      interface RaceInfo {
        name: string;
        link: string;
        winner: string;
        category: string;
        isStageRace: boolean;
        startDay?: number;
        isFinalStage?: boolean;
        stageIndex?: number;
        baseRaceName?: string;
        isTTT?: boolean;
        tttTeamClassification?: string;
        tttWinnerRiders?: string[];
      }

      const todayRaces: RaceInfo[] = [];
      const stageRacesToday: RaceInfo[] = [];

      $("table tr").each((_i, el) => {
        const rowText = $(el).text().trim().replace(/\s+/g, " ");
        if (!rowText || rowText.startsWith("Date")) return;

        const cells = $(el).find("td");
        if (cells.length < 2) return;

        const dateCell = $(cells[0]).text().trim();
        const raceLink = $(el).find("a[href*='race/']");
        const raceName = raceLink.text().trim();
        const href = raceLink.attr("href") || "";
        const fullLink = href.startsWith("http")
          ? href
          : `https://www.procyclingstats.com/${href}`;

        if (!raceName) return;

        const lastCell = $(cells[cells.length - 1]).text().trim();

        const rangeMatch = dateCell.match(/(\d{2})\.(\d{2})\s*-\s*(\d{2})\.(\d{2})/);
        if (rangeMatch) {
          const startDay = parseInt(rangeMatch[1]);
          const startMonth = parseInt(rangeMatch[2]);
          const endDay = parseInt(rangeMatch[3]);
          const endMonth = parseInt(rangeMatch[4]);
          const currentDay = today.getDate();
          const currentMonth = today.getMonth() + 1;

          if (
            (currentMonth > startMonth || (currentMonth === startMonth && currentDay >= startDay)) &&
            (currentMonth < endMonth || (currentMonth === endMonth && currentDay <= endDay))
          ) {
            stageRacesToday.push({
              name: raceName,
              link: fullLink,
              winner: "",
              category: lastCell,
              isStageRace: true,
              startDay,
            });
          }
          return;
        }

        if (dateCell.includes(todayDotFormat)) {
          let winner = "";
          cells.each((_j: number, cell: any) => {
            const t = $(cell).text().trim();
            if (
              t.length > 3 &&
              t !== raceName &&
              t !== dateCell &&
              t !== lastCell &&
              !t.match(/^\d{2}\.\d{2}/) &&
              t.match(/^[A-Z]/)
            ) {
              winner = t;
            }
          });

          if (winner) {
            logger?.info(`🏆 [webSearchRaces] Found finished race: ${raceName} - Winner: ${winner} (${lastCell})`);
            todayRaces.push({
              name: raceName,
              link: fullLink,
              winner,
              category: lastCell,
              isStageRace: false,
            });
          }
        }
      });

      logger?.info(`📊 [webSearchRaces] Found ${todayRaces.length} one-day race(s) and ${stageRacesToday.length} stage race(s)`);

      const allRacesToProcess = [...todayRaces];

      for (const stage of stageRacesToday) {
        try {
          logger?.info(`📋 [webSearchRaces] Checking stage race: ${stage.name}`);

          // Normalize link: strip /gc, /result, /stage-X suffixes so we always fetch the race overview page
          const baseRaceUrl = stage.link.replace(/\/(gc|result|stage-[^/]*)$/, '');
          logger?.info(`📋 [webSearchRaces] Race overview URL: ${baseRaceUrl} (from calendar link: ${stage.link})`);
          const stageHtml = await fetchPage(baseRaceUrl, 20000, logger);

          if (stageHtml.includes("Just a moment")) continue;

          const s$ = cheerio.load(stageHtml);

          const stageLinks: Array<{ href: string; text: string }> = [];
          s$("ul.list li a, a[href*='/stage-']").each((_i, el) => {
            const href = s$(el).attr("href") || "";
            const text = s$(el).text().trim();
            if (href.includes("/stage-") || href.includes("/prologue")) {
              stageLinks.push({
                href: href.startsWith("http") ? href : `https://www.procyclingstats.com/${href}`,
                text,
              });
            }
          });

          const actualStageLinks = stageLinks.filter(sl => sl.href.match(/\/stage-\d+[a-z]?$/) || sl.href.includes("/prologue"));
          logger?.info(`📋 [webSearchRaces] Found ${actualStageLinks.length} stage link(s) for ${stage.name}`);

          if (actualStageLinks.length === 0) continue;

          const raceStartDay = stage.startDay || 0;
          const todayStageIdx = raceStartDay > 0 ? today.getDate() - raceStartDay : -1;
          logger?.info(`📋 [webSearchRaces] ${stage.name}: startDay=${raceStartDay}, todayStageIdx=${todayStageIdx}, total stages=${actualStageLinks.length}`);

          // Build list of stage indices to try:
          // - Start from up to 2 stages back (catch-up for server crashes)
          // - Up to 1 stage ahead (split stages like 3a/3b on same day)
          let stageIndicesToTry: number[] = [];
          if (todayStageIdx < 0) {
            // Fallback: try the last available stage
            stageIndicesToTry.push(actualStageLinks.length - 1);
          } else if (todayStageIdx >= actualStageLinks.length) {
            // Race is over, try the final stage
            stageIndicesToTry.push(actualStageLinks.length - 1);
          } else {
            const firstIdx = Math.max(0, todayStageIdx - 2);
            const lastIdx = Math.min(actualStageLinks.length - 1, todayStageIdx + 1);
            for (let i = firstIdx; i <= lastIdx; i++) stageIndicesToTry.push(i);
          }
          logger?.info(`📋 [webSearchRaces] ${stage.name}: trying stage indices [${stageIndicesToTry.join(', ')}]`);

          if (stageIndicesToTry.length === 0) continue;

          for (const stageIdx of stageIndicesToTry) {
            const stageToFetch = actualStageLinks[stageIdx].href;
            const isFinalStage = stageIdx === actualStageLinks.length - 1;
            logger?.info(`📋 [webSearchRaces] Trying stage [${stageIdx}]: ${stageToFetch}${isFinalStage ? ' (FINAL STAGE)' : ''}`);

            try {
              const stageResultHtml = await fetchPage(stageToFetch, 20000, logger);

              if (stageResultHtml.includes("Just a moment")) continue;

              const st$ = cheerio.load(stageResultHtml);
              const allRows = st$("table.results tbody tr, table.basic tbody tr");
              const nonFinisherStatuses = ["DNS", "DNF", "OTL", "DSQ", "DF"];
              const finisherRows = allRows.filter((i: number, row: any) => {
                const rankText = st$(row).find("td").first().text().trim().toUpperCase();
                return !nonFinisherStatuses.includes(rankText) && rankText !== "";
              });
              const nonFinisherCount = allRows.filter((i: number, row: any) => {
                const rank = st$(row).find("td").first().text().trim().toUpperCase();
                return nonFinisherStatuses.includes(rank);
              }).length;

              // Race is complete if it has DNS/DNF entries (added by PCS only after race ends)
              // OR has at least 80 finishers (large field, almost certainly done).
              // This prevents picking up partial live results (e.g. only 42 of 160 riders finished).
              const hasResults = finisherRows.length > 3;
              const isRaceComplete = hasResults && (nonFinisherCount > 0 || finisherRows.length >= 80);

              if (!hasResults) {
                logger?.info(`📋 [webSearchRaces] Too few finishers (${finisherRows.length}) for ${stageToFetch}, skipping`);
              } else if (!isRaceComplete) {
                logger?.info(`📋 [webSearchRaces] Race likely still in progress: ${finisherRows.length} finishers, ${nonFinisherCount} DNS/DNF — skipping ${stageToFetch}`);
              }

              if (isRaceComplete) {
                const stageTitle = st$("h1, .page-title, title").first().text().trim().split("|")[0].trim();
                const isTTT = stageTitle.includes("(TTT)") || st$(".title-line2").text().includes("(TTT)");

                if (isTTT) {
                  logger?.info(`🏁 [webSearchRaces] TTT (Team Time Trial) detected: ${stageTitle}`);

                  const ridersByTeam: Record<string, string[]> = {};
                  finisherRows.each((_ri: number, row: any) => {
                    const rider = st$(row).find("a[href*='rider/']").first().text().trim();
                    const team = st$(row).find("a[href*='team/']").first().text().trim();
                    if (!team || !rider) return;
                    if (!ridersByTeam[team]) ridersByTeam[team] = [];
                    if (!ridersByTeam[team].includes(rider)) {
                      ridersByTeam[team].push(rider);
                    }
                  });

                  const teamList: Array<{ team: string; time: string; riders: string[] }> = [];
                  const allTables = st$("table.results");
                  let teamDayTable: any = null;
                  allTables.each((_ti: number, table: any) => {
                    const h3 = st$(table).prevAll("h3").first().text().trim().toLowerCase();
                    const dataCodes = st$(table).find("thead tr th[data-code]").map((_i: number, th: any) => st$(th).attr("data-code")).get().join(",");
                    if (h3.includes("team day") || (dataCodes.includes("teamline") && !dataCodes.includes("prev"))) {
                      teamDayTable = table;
                    }
                  });

                  if (!teamDayTable) {
                    allTables.each((_ti: number, table: any) => {
                      const dataCodes = st$(table).find("thead tr th[data-code]").map((_i: number, th: any) => st$(th).attr("data-code")).get().join(",");
                      if (dataCodes.includes("teamline") && dataCodes.includes("time")) {
                        teamDayTable = table;
                      }
                    });
                  }

                  if (teamDayTable) {
                    logger?.info(`🏁 [webSearchRaces] TTT: found "Team day classification" table`);
                    const teamRows = st$(teamDayTable).find("tbody tr");
                    teamRows.each((_ri: number, row: any) => {
                      const teamEl = st$(row).find("a[href*='team/']").first();
                      const teamName = teamEl.text().trim();
                      if (!teamName) return;
                      const timeTd = st$(row).find("td.time").first();
                      const timeHide = timeTd.find("span.hide").text().trim();
                      const timeFont = timeTd.find("font").text().trim();
                      let timeText = timeHide || timeFont || timeTd.text().trim();
                      if (teamList.length === 0) {
                        timeText = "0:00";
                      }
                      teamList.push({
                        team: teamName,
                        time: timeText,
                        riders: ridersByTeam[teamName] || [],
                      });
                    });
                    logger?.info(`🏁 [webSearchRaces] TTT: extracted ${teamList.length} teams from team day classification`);
                  } else {
                    logger?.warn(`⚠️ [webSearchRaces] TTT: "Team day classification" table not found, falling back to individual results`);
                    const teamOrder: string[] = [];
                    finisherRows.each((_ri: number, row: any) => {
                      const team = st$(row).find("a[href*='team/']").first().text().trim();
                      if (team && !teamOrder.includes(team)) teamOrder.push(team);
                    });
                    for (const t of teamOrder) {
                      const firstRider = finisherRows.toArray().find((row: any) => st$(row).find("a[href*='team/']").first().text().trim() === t);
                      const timeTd = firstRider ? st$(firstRider).find("td.time").first() : null;
                      const timeText = timeTd ? (timeTd.find("span.hide").text().trim() || timeTd.find("font").text().trim() || timeTd.text().trim()) : "";
                      teamList.push({ team: t, time: teamList.length === 0 ? "0:00" : timeText, riders: ridersByTeam[t] || [] });
                    }
                  }

                  let tttClassification = "";
                  teamList.slice(0, 20).forEach((t, idx) => {
                    tttClassification += `${idx + 1}. ${t.team} - ${t.time} (${t.riders.slice(0, 4).join(", ")}${t.riders.length > 4 ? "..." : ""})\n`;
                  });

                  const winnerTeam = teamList[0];
                  const winnerName = winnerTeam ? winnerTeam.team : "Unknown Team";
                  logger?.info(`🏆 [webSearchRaces] TTT winner: ${winnerName} (${winnerTeam?.riders.length || 0} riders)${isFinalStage ? ' (FINAL STAGE)' : ''}`);

                  allRacesToProcess.push({
                    name: stageTitle || `${stage.name} - Today's Stage`,
                    link: stageToFetch,
                    winner: winnerName,
                    category: stage.category,
                    isStageRace: true,
                    isFinalStage,
                    stageIndex: stageIdx + 1,
                    baseRaceName: stage.name,
                    isTTT: true,
                    tttTeamClassification: tttClassification,
                    tttWinnerRiders: winnerTeam?.riders || [],
                  });
                } else {
                const firstFinisher = finisherRows.first();
                const rankText = firstFinisher.find("td").first().text().trim();
                const winnerEl = firstFinisher.find("a[href*='rider/']").first();
                const winner = winnerEl.text().trim() || "";

                let resolvedWinner = winner;
                if (!resolvedWinner && rankText === "1") {
                  const tds = firstFinisher.find("td");
                  if (tds.length >= 2) {
                    resolvedWinner = st$(tds[1]).text().trim();
                  }
                }
                if (resolvedWinner && rankText === "1") {
                  logger?.info(`🏆 [webSearchRaces] Stage result found: ${stageTitle} - Winner: ${resolvedWinner}${isFinalStage ? ' (FINAL STAGE)' : ''}`);
                  allRacesToProcess.push({
                    name: stageTitle || `${stage.name} - Today's Stage`,
                    link: stageToFetch,
                    winner: resolvedWinner,
                    category: stage.category,
                    isStageRace: true,
                    isFinalStage,
                    stageIndex: stageIdx + 1,
                    baseRaceName: stage.name,
                  });
                } else {
                  logger?.info(`📋 [webSearchRaces] Results found but no rank=1 winner (first rank: "${rankText}", winner: "${resolvedWinner}"), skipping ${stageToFetch}`);
                }
                }
              } else if (allRows.length === 0) {
                logger?.info(`📋 [webSearchRaces] No results yet for ${stageToFetch}, skipping (will retry next hour)`);
              }
            } catch (fetchErr) {
              logger?.warn(`⚠️ [webSearchRaces] Failed to fetch stage ${stageToFetch}`);
            }
          }
        } catch (err) {
          logger?.warn(`⚠️ [webSearchRaces] Could not check stage race ${stage.name}`);
        }
      }

      if (allRacesToProcess.length === 0) {
        logger?.info("ℹ️ [webSearchRaces] No finished races found today");
        return { found: false, searchResults: "" };
      }

      let searchResults = `Cycling races finished on ${dateStr}:\n\n`;
      const pendingGcBlocks: Array<{ block: string; raceName: string; gcWinner: string }> = [];

      for (const race of allRacesToProcess) {
        logger?.info(`📋 [webSearchRaces] Fetching results for: ${race.name}`);

        searchResults += `## ${race.name} (${race.category})\n`;
        if (race.stageIndex !== undefined) {
          searchResults += `Stage Index: ${race.stageIndex}\n`;
        }
        if (race.isTTT) {
          searchResults += `Type: TTT (Team Time Trial)\n`;
          searchResults += `Winner: ${race.winner}\n`;
          if (race.tttWinnerRiders && race.tttWinnerRiders.length > 0) {
            searchResults += `Winning team riders: ${race.tttWinnerRiders.join(", ")}\n`;
          }
        } else {
          searchResults += `Winner: ${race.winner}\n`;
        }

        try {
          const raceHtml = await fetchPage(race.link, 20000, logger);

          if (raceHtml.includes("Just a moment")) {
            searchResults += `Classification: Not available (blocked)\n\n`;
            continue;
          }

          const r$ = cheerio.load(raceHtml);

          try {
            let distance = "";
            r$("div.infolist div").each((_i, el) => {
              const label = r$(el).find(".label").text().trim();
              const value = r$(el).find(".value").text().trim();
              if (label.toLowerCase().includes("distance") && value.includes("km")) {
                distance = value;
              }
            });
            if (!distance) {
              const pageText = r$("body").text();
              const distMatch = pageText.match(/(\d+[\.,]?\d*)\s*km/);
              if (distMatch) {
                distance = distMatch[0];
              }
            }
            if (distance) {
              searchResults += `Distance: ${distance}\n`;
              logger?.info(`📏 [webSearchRaces] Distance: ${distance}`);
            }
          } catch (distErr) {
            logger?.warn("⚠️ [webSearchRaces] Could not extract distance");
          }

          try {
            let route = "";
            const titleLine2 = r$(".title-line2, .imob").first().text().trim();
            if (titleLine2 && titleLine2.includes("›")) {
              route = titleLine2.replace(/\s*\(\d+[\.,]?\d*\s*km\)\s*/, "").trim();
            }
            if (!route) {
              const headerText = r$("div.main h1, div.page-title").first().text().trim();
              if (headerText.includes("›")) {
                route = headerText.replace(/\s*\(\d+[\.,]?\d*\s*km\)\s*/, "").trim();
              }
            }
            if (route) {
              searchResults += `Route: ${route}\n`;
              logger?.info(`🗺️ [webSearchRaces] Route: ${route}`);
            }
          } catch (routeErr) {
            logger?.warn("⚠️ [webSearchRaces] Could not extract route");
          }

          try {
            const pageText = r$("body").text();
            const avgSpeedMatch = pageText.match(/Avg\.\s*speed.*?(\d+[\.,]\d+)\s*km\/h/);
            if (avgSpeedMatch) {
              searchResults += `Avg Speed: ${avgSpeedMatch[1]} km/h\n`;
              logger?.info(`⚡ [webSearchRaces] Avg Speed: ${avgSpeedMatch[1]} km/h`);
            }
          } catch (speedErr) {
            logger?.warn("⚠️ [webSearchRaces] Could not extract avg speed");
          }

          try {
            let elevationGain = "";
            const raceBaseUrl = race.link.replace(/\/stage-\d+$/, "").replace(/\/result$/, "");
            const routeUrl = raceBaseUrl.endsWith("/route") ? raceBaseUrl : `${raceBaseUrl}/route`;
            logger?.info(`⛰️ [webSearchRaces] Fetching route page for elevation: ${routeUrl}`);
            const routeHtml = await fetchPage(routeUrl, 15000, logger);
            if (routeHtml && !routeHtml.includes("Just a moment")) {
              const rt$ = cheerio.load(routeHtml);
              const stageMatch = race.link.match(/stage-(\d+)/);
              const stageNum = stageMatch ? parseInt(stageMatch[1]) : null;

              rt$("table").first().find("tr").each((_i, tr) => {
                const tds = rt$(tr).find("td");
                if (tds.length >= 7) {
                  const stageCell = rt$(tds[2]).text().trim();
                  const vertMeters = rt$(tds[tds.length - 1]).text().trim();
                  if (stageNum) {
                    if (stageCell.toLowerCase().includes(`stage ${stageNum}`) || stageCell === `${stageNum}`) {
                      if (vertMeters && vertMeters.match(/^\d+/)) {
                        elevationGain = vertMeters;
                      }
                    }
                  } else {
                    if (vertMeters && vertMeters.match(/^\d+/) && stageCell.match(/stage|1/i)) {
                      elevationGain = vertMeters;
                    }
                  }
                }
              });

              if (!elevationGain) {
                const lastRow = rt$("table").first().find("tr").last();
                const lastTds = lastRow.find("td");
                if (lastTds.length >= 2) {
                  const totalVert = rt$(lastTds[lastTds.length - 1]).text().trim();
                  if (totalVert && totalVert.match(/^\d+/) && !stageNum) {
                    elevationGain = totalVert;
                  }
                }
              }
            }

            if (elevationGain) {
              searchResults += `Elevation gain: ${elevationGain} m\n`;
              logger?.info(`⛰️ [webSearchRaces] Elevation gain: ${elevationGain} m`);
            } else {
              logger?.info("⛰️ [webSearchRaces] Elevation gain not available on route page");
            }
          } catch (elevErr) {
            logger?.warn("⚠️ [webSearchRaces] Could not extract elevation gain");
          }

          if (race.isTTT && race.tttTeamClassification) {
            searchResults += "Team Classification (TTT):\n";
            searchResults += race.tttTeamClassification;
          } else {
            searchResults += "Classification:\n";
            let foundResults = false;

            r$("table.results tbody tr, table.basic tbody tr").each((_i, tr) => {
              const tds = r$(tr).find("td");
              if (tds.length >= 3) {
                const pos = r$(tds[0]).text().trim();
                if (pos.match(/^\d+$/) && parseInt(pos) <= 20) {
                  foundResults = true;
                  const riderLink = r$(tr).find("a[href*='rider/']");
                  const rider = riderLink.first().text().trim() || r$(tds[1]).text().trim();
                  const teamLink = r$(tr).find("a[href*='team/']");
                  const team = teamLink.text().trim() || "";
                  const lastTd = r$(tds[tds.length - 1]).text().trim();
                  searchResults += `${pos}. ${rider} (${team}) - ${lastTd}\n`;
                }
              }
            });

            if (!foundResults) {
              searchResults += "Full classification not available\n";
            }
          }

          if (race.isStageRace) {
            try {
              logger?.info(`📊 [webSearchRaces] Extracting GC from stage result page for ${race.name}`);

              // The stage result page already contains GC positions for each rider
              // in the column with data-code="gc". No separate fetch needed.
              let gcColIdx = -1;
              let gcTimeColIdx = -1;
              let gcTableEl: ReturnType<typeof r$> | null = null;

              r$("table.results, table.basic").each((_ti, tbl) => {
                if (gcTableEl) return;
                let foundGc = false;
                let localGcIdx = -1;
                let localGcTimeIdx = -1;
                r$(tbl).find("thead th").each((hi, th) => {
                  const code = r$(th).attr("data-code") || "";
                  if (code === "gc") { localGcIdx = hi; foundGc = true; }
                  if (code === "gc_timelag") localGcTimeIdx = hi;
                });
                if (foundGc) {
                  gcColIdx = localGcIdx;
                  gcTimeColIdx = localGcTimeIdx;
                  gcTableEl = r$(tbl);
                  logger?.info(`📊 [webSearchRaces] Found GC column at index ${gcColIdx} in stage result table`);
                }
              });

              if (gcTableEl && gcColIdx >= 0) {
                const gcEntries: { gcPos: number; rider: string; team: string; gcTime: string }[] = [];

                gcTableEl.find("tbody tr").each((_i, tr) => {
                  const tds = r$(tr).find("td");
                  if (tds.length <= gcColIdx) return;
                  const gcPosText = r$(tds[gcColIdx]).text().trim();
                  if (!gcPosText.match(/^\d+$/)) return;
                  const gcPos = parseInt(gcPosText);
                  if (gcPos > 10) return;
                  const riderLink = r$(tr).find("a[href*='rider/']");
                  const rider = riderLink.first().text().trim();
                  if (!rider) return;
                  const teamLink = r$(tr).find("a[href*='team/']");
                  const team = teamLink.text().trim() || "";
                  const gcTime = gcTimeColIdx >= 0 && tds.length > gcTimeColIdx
                    ? r$(tds[gcTimeColIdx]).text().trim()
                    : "";
                  gcEntries.push({ gcPos, rider, team, gcTime });
                });

                gcEntries.sort((a, b) => a.gcPos - b.gcPos);

                if (gcEntries.length > 0) {
                  let gcResults = "";
                  for (const e of gcEntries) {
                    gcResults += `${e.gcPos}. ${e.rider} (${e.team})${e.gcTime ? ` - ${e.gcTime}` : ""}\n`;
                  }
                  searchResults += `\nGeneral Classification:\n${gcResults}`;
                  logger?.info(`📊 [webSearchRaces] GC extracted (${gcEntries.length} riders) for ${race.name}`);

                  if (race.isFinalStage && race.baseRaceName) {
                    const gcWinner = gcEntries[0]?.rider || "";
                    if (gcWinner) {
                      logger?.info(`🏆 [webSearchRaces] Final GC winner: ${gcWinner} — will generate separate GC article for ${race.baseRaceName}`);
                      const gcBlock = `\n## ${race.baseRaceName} 2026 - Classifica Generale Finale (${race.category})\nWinner: ${gcWinner}\nType: Final General Classification\n\nFinal General Classification:\n${gcResults}`;
                      pendingGcBlocks.push({ block: gcBlock, raceName: race.baseRaceName, gcWinner });
                    }
                  }
                } else {
                  logger?.info(`📊 [webSearchRaces] GC column found but no top-10 entries extracted for ${race.name}`);
                }
              } else {
                logger?.info(`📊 [webSearchRaces] No GC column (data-code="gc") in stage result table for ${race.name}`);
              }
            } catch (gcErr) {
              logger?.warn(`⚠️ [webSearchRaces] Could not extract GC for ${race.name}: ${gcErr}`);
            }
          }

          try {
            const narrative = await fetchRaceNarrative(race.name, race.winner, logger);
            if (narrative) {
              const sourceMatch = narrative.match(/^\[Source: (.+?)\]/);
              const sourceName = sourceMatch ? sourceMatch[1] : "external";
              searchResults += `\nRace Narrative (from ${sourceName}):\n${narrative.replace(/^\[Source: .+?\]\n/, "")}\n`;
              logger?.info(`📰 [webSearchRaces] Added race narrative for ${race.name} from ${sourceName} (${narrative.length} chars)`);
            } else {
              logger?.info(`📰 [webSearchRaces] No race narrative found for ${race.name}`);
            }
          } catch (narrativeErr) {
            logger?.warn(`⚠️ [webSearchRaces] Could not fetch race narrative for ${race.name}: ${narrativeErr instanceof Error ? narrativeErr.message : String(narrativeErr)}`);
          }

          searchResults += "\n";
        } catch (err) {
          searchResults += "Results page unavailable\n\n";
        }
      }

      for (const gcEntry of pendingGcBlocks) {
        logger?.info(`📊 [webSearchRaces] Adding final GC block for ${gcEntry.raceName} (winner: ${gcEntry.gcWinner})`);
        searchResults += gcEntry.block;

        try {
          const gcNarrative = await fetchRaceNarrative(
            `${gcEntry.raceName} classifica generale`,
            gcEntry.gcWinner,
            logger,
          );
          if (gcNarrative) {
            const sourceMatch = gcNarrative.match(/^\[Source: (.+?)\]/);
            const sourceName = sourceMatch ? sourceMatch[1] : "external";
            searchResults += `\nRace Narrative (from ${sourceName}):\n${gcNarrative.replace(/^\[Source: .+?\]\n/, "")}\n`;
            logger?.info(`📰 [webSearchRaces] Added GC narrative for ${gcEntry.raceName} from ${sourceName}`);
          } else {
            logger?.info(`📰 [webSearchRaces] No separate GC narrative found for ${gcEntry.raceName}`);
          }
        } catch (narrativeErr) {
          logger?.warn(`⚠️ [webSearchRaces] Could not fetch GC narrative for ${gcEntry.raceName}`);
        }

        searchResults += "\n";
      }

      const totalRaces = allRacesToProcess.length + pendingGcBlocks.length;
      logger?.info(`✅ [webSearchRaces] Compiled results for ${totalRaces} race(s) (${allRacesToProcess.length} stages + ${pendingGcBlocks.length} GC finals), total text: ${searchResults.length} chars`);

      return { found: true, searchResults };
    } catch (error) {
      logger?.error("❌ [webSearchRaces] Error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { found: false, searchResults: "" };
    }
  },
});
