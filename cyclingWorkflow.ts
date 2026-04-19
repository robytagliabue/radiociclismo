import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import axios from "axios";
import { cyclingAgent } from "../agents/cyclingAgent";
import { webSearchRacesTool, fetchRaceNarrative } from "../tools/webSearchRacesTool";
import { getPool, ensurePublishedArticlesTable, savePendingArticles, loadPendingArticles, removePendingArticle, clearPendingArticles, acquireWorkflowLock, releaseWorkflowLock } from "../db";

const rankingEntrySchema = z.object({
  position: z.union([z.number(), z.string()]),
  name: z.string(),
  team: z.string().optional().default(""),
  time: z.string().optional().default(""),
});

const articleSchema = z.object({
  titleIt: z.string(),
  subtitleIt: z.string().optional().default(""),
  excerptIt: z.string(),
  contentIt: z.string(),
  titleEn: z.string(),
  subtitleEn: z.string().optional().default(""),
  excerptEn: z.string(),
  contentEn: z.string(),
  slug: z.string(),
  hashtags: z.string(),
  winnerName: z.string(),
  raceName: z.string(),
  metaDescription: z.string().optional().default(""),
  primaryKeyword: z.string().optional().default(""),
  alternativeTitles: z.array(z.string()).optional().default([]),
  socialVersion: z.string().optional().default(""),
  instagramVersion: z.string().optional().default(""),
  bulletPoints: z.array(z.string()).optional().default([]),
  styleUsed: z.string().optional().default(""),
  structureUsed: z.string().optional().default(""),
  rankings: z.array(rankingEntrySchema).optional().default([]),
  stageNumber: z.number().nullable().optional().default(null),
  isStageRace: z.boolean().optional().default(false),
  isFinalGC: z.boolean().optional().default(false),
  isTTT: z.boolean().optional().default(false),
  startLocation: z.string().optional().default(""),
  endLocation: z.string().optional().default(""),
  raceDistance: z.string().optional().default(""),
  raceDate: z.string().optional().default(""),
  raceCategory: z.string().optional().default(""),
  resultsOnly: z.boolean().optional().default(false),
  gcRankings: z.array(rankingEntrySchema).optional().default([]),
});

const searchRacesStep = createStep({
  id: "search-races",
  description: "Scrapes PCS for today's finished cycling races with enriched data",
  inputSchema: z.object({}),
  outputSchema: z.object({
    found: z.boolean(),
    searchResults: z.string(),
    lockAcquired: z.boolean().optional(),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔍 [Step: searchRaces] Starting web search for today's races...");

    let lockAcquired = true;
    try {
      const locked = await acquireWorkflowLock();
      if (!locked) {
        logger?.warn("🔒 [Step: searchRaces] Another workflow run is already in progress — skipping this run to avoid concurrent execution");
        return { found: false, searchResults: "", lockAcquired: false };
      }
      logger?.info("🔓 [Step: searchRaces] Workflow lock acquired successfully");
      lockAcquired = true;
    } catch (lockErr: any) {
      logger?.warn(`⚠️ [Step: searchRaces] Could not check workflow lock: ${lockErr.message} — proceeding anyway`);
      lockAcquired = true;
    }

    try {
      const result = await webSearchRacesTool.execute({
        context: {},
        mastra: mastra as any,
        runId: "workflow-search",
        threadId: "workflow",
        resourceId: "workflow",
        runtimeContext: {} as any,
      });

      logger?.info(`📊 [Step: searchRaces] Search completed, found data: ${result?.found}`);
      if (result?.found) {
        logger?.info(`📊 [Step: searchRaces] Results length: ${result?.searchResults?.length} chars`);
      }
      return {
        found: result?.found || false,
        searchResults: result?.searchResults || "",
        lockAcquired,
      };
    } catch (error) {
      logger?.error("❌ [Step: searchRaces] Error", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { found: false, searchResults: "", lockAcquired };
    }
  },
});

function normalizeRaceName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function generateWithTimeout(prompt: string, timeoutMs: number = 120000): Promise<any> {
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`LLM call timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    try {
      const response = await cyclingAgent.generateLegacy(
        [{ role: "user", content: prompt }],
        { maxSteps: 1 },
      );
      clearTimeout(timer);
      resolve(response);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

function parseRankingsFromBlock(raceBlock: string): Array<{ position: number | string; name: string; team: string; time: string }> {
  const rankings: Array<{ position: number | string; name: string; team: string; time: string }> = [];

  const tttMatch = raceBlock.match(/Team Classification \(TTT\):\n([\s\S]*?)(?:\n(?:GC |General Classification|Race Narrative|\n##)|\n\n|$)/);
  if (tttMatch) {
    const lines = tttMatch[1].split("\n").filter(l => l.trim());
    for (const line of lines) {
      const match = line.match(/^(\d+)\.\s*(.+?)\s*-\s*([^\(]+)\s*\((.+)\)$/);
      if (match) {
        rankings.push({
          position: parseInt(match[1]),
          name: match[2].trim(),
          team: match[2].trim(),
          time: match[3].trim(),
        });
      }
    }
    return rankings;
  }

  const classificationMatch = raceBlock.match(/Classification:\n([\s\S]*?)(?:\n(?:GC |General Classification|Race Narrative|\n##)|\n\n|$)/);
  if (!classificationMatch) return rankings;

  const lines = classificationMatch[1].split("\n").filter(l => l.trim());
  for (const line of lines) {
    const match = line.match(/^(\d+|DNF|DNS|OTL|DSQ)\.\s*(.+?)\s*\(([^)]*)\)\s*-\s*(.*)$/);
    if (match) {
      const pos = match[1].match(/^\d+$/) ? parseInt(match[1]) : match[1];
      rankings.push({
        position: pos,
        name: match[2].trim(),
        team: match[3].trim(),
        time: match[4].trim(),
      });
    }
  }
  return rankings;
}

function parseGCRankingsFromBlock(raceBlock: string): Array<{ position: number | string; name: string; team: string; time: string }> {
  const rankings: Array<{ position: number | string; name: string; team: string; time: string }> = [];
  const gcMatch = raceBlock.match(/General Classification:\n([\s\S]*?)(?:\n(?:Race Narrative|\n##)|$)/);
  if (!gcMatch) return rankings;
  const lines = gcMatch[1].split("\n").filter(l => l.trim());
  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s*(.+?)\s*\(([^)]*)\)\s*-\s*(.*)$/);
    if (match) {
      rankings.push({
        position: parseInt(match[1]),
        name: match[2].trim(),
        team: match[3].trim(),
        time: match[4].trim(),
      });
    }
  }
  return rankings;
}

function parseRaceMetaFromBlock(raceBlock: string): {
  stageNumber: number | null;
  isStageRace: boolean;
  isFinalGC: boolean;
  isTTT: boolean;
  startLocation: string;
  endLocation: string;
  raceDistance: string;
  raceCategory: string;
} {
  const stageMatchFull = raceBlock.match(/Stage\s+(\d+)([a-z]?)/i);
  let stageNumber: number | null = null;
  if (stageMatchFull) {
    const baseNum = parseInt(stageMatchFull[1]);
    stageNumber = baseNum;
  }
  const stageIndexMatch = raceBlock.match(/^Stage Index:\s*(\d+)/m);
  if (stageIndexMatch) {
    stageNumber = parseInt(stageIndexMatch[1]);
  }
  const isStageRace = stageNumber !== null || raceBlock.includes("GC Classification") || raceBlock.includes("FINAL STAGE");
  const isFinalGC = raceBlock.includes("Type: Final General Classification");
  const isTTT = raceBlock.includes("Type: TTT") || raceBlock.includes("Team Classification (TTT)");

  let startLocation = "";
  let endLocation = "";
  const routeMatch = raceBlock.match(/Route:\s*(?:Stage \d+.*?»\s*|One day race\s*»\s*)?(.+?)\s*›\s*(.+?)(?:\n|$)/);
  if (routeMatch) {
    startLocation = routeMatch[1].trim();
    endLocation = routeMatch[2].trim();
  }

  const distMatch = raceBlock.match(/Distance:\s*(.+?)(?:\n|$)/);
  const raceDistance = distMatch ? distMatch[1].trim() : "";

  const headerLine = (raceBlock.match(/^## .+/m) || [""])[0];
  const allCatMatches = [...headerLine.matchAll(/\(([^)]+)\)/g)];
  const raceCategory = allCatMatches.length > 0 ? allCatMatches[allCatMatches.length - 1][1].trim() : "";

  return { stageNumber, isStageRace, isFinalGC, isTTT, startLocation, endLocation, raceDistance, raceCategory };
}


const retryNarrativesStep = createStep({
  id: "retry-narratives",
  description: "If any races are missing CyclingNews narratives, waits 10 minutes and retries fetching them",
  inputSchema: z.object({
    found: z.boolean(),
    searchResults: z.string(),
    lockAcquired: z.boolean().optional(),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    searchResults: z.string(),
    lockAcquired: z.boolean().optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const lockAcquired = inputData.lockAcquired ?? true;

    if (!inputData.found || !inputData.searchResults) {
      logger?.info("⏭️ [Step: retryNarratives] No race data, skipping narrative retry");
      return { found: false, searchResults: "", lockAcquired };
    }

    const raceBlocks = inputData.searchResults.split(/(?=## )/).filter(block => block.trim().startsWith("## "));

    const majorCategories = new Set(["UWT", "WT", "2.UWT", "1.UWT", "2.WWT", "1.WWT", "2.Pro", "1.Pro", "ProS"]);
    const racesWithoutNarrative: Array<{ index: number; raceName: string; winner: string }> = [];

    for (let i = 0; i < raceBlocks.length; i++) {
      const block = raceBlocks[i];
      const hasNarrative = block.includes("Race Narrative (from");
      if (!hasNarrative) {
        const nameMatch = block.match(/^## (.+?)(?:\s*\(|$)/m);
        const winnerMatch = block.match(/Winner:\s*(.+?)(?:\n|$)/m);
        const hdrLine = (block.match(/^## .+/m) || [""])[0];
        const allCatM = [...hdrLine.matchAll(/\(([^)]+)\)/g)];
        const raceName = nameMatch ? nameMatch[1].trim() : "";
        const winner = winnerMatch ? winnerMatch[1].trim() : "";
        const cat = allCatM.length > 0 ? allCatM[allCatM.length - 1][1].trim() : "unknown";
        if (raceName) {
          if (!majorCategories.has(cat)) {
            logger?.info(`⏭️ [Step: retryNarratives] Skipping retry for "${raceName}" (${cat}) — minor race, no need to wait`);
            continue;
          }
          racesWithoutNarrative.push({ index: i, raceName, winner });
        }
      }
    }

    if (racesWithoutNarrative.length === 0) {
      logger?.info("✅ [Step: retryNarratives] All major races have narratives (or only minor races without), no retry needed");
      return inputData;
    }

    // Before waiting, check which of these races are ALREADY published in DB — no need to wait for them
    try {
      const pool = getPool();
      const alreadyPublished: string[] = [];
      for (const race of racesWithoutNarrative) {
        const res = await pool.query(
          "SELECT 1 FROM published_articles WHERE race_name = $1 LIMIT 1",
          [race.raceName]
        );
        if (res.rows.length > 0) {
          alreadyPublished.push(race.raceName);
        }
      }
      const unpublishedMissing = racesWithoutNarrative.filter(r => !alreadyPublished.includes(r.raceName));
      if (alreadyPublished.length > 0) {
        logger?.info(`⏭️ [Step: retryNarratives] Skipping wait for already-published races: ${alreadyPublished.join(", ")}`);
      }
      if (unpublishedMissing.length === 0) {
        logger?.info("✅ [Step: retryNarratives] All races missing narrative are already published — skipping retry wait");
        return inputData;
      }
      // Restrict wait only to unpublished races that actually need a narrative
      racesWithoutNarrative.length = 0;
      racesWithoutNarrative.push(...unpublishedMissing);
    } catch (dbErr: any) {
      logger?.warn(`⚠️ [Step: retryNarratives] Could not check DB for published articles: ${dbErr.message} — proceeding with immediate retry`);
    }

    logger?.info(`🔄 [Step: retryNarratives] ${racesWithoutNarrative.length} major unpublished race(s) missing narrative — retrying immediately: ${racesWithoutNarrative.map(r => r.raceName).join(", ")}`);
    logger?.info("🔄 [Step: retryNarratives] Retrying narrative fetch now (no blocking wait)...");

    let updatedCount = 0;
    for (const race of racesWithoutNarrative) {
      try {
        const narrative = await fetchRaceNarrative(race.raceName, race.winner, logger);
        if (narrative) {
          const block = raceBlocks[race.index];
          const sourceMatch = narrative.match(/^\[Source: (.+?)\]/);
          const sourceName = sourceMatch ? sourceMatch[1] : "external";
          const narrativeText = narrative.replace(/^\[Source: .+?\]\n/, "");
          raceBlocks[race.index] = block.trimEnd() + `\nRace Narrative (from ${sourceName}):\n${narrativeText}\n\n`;
          updatedCount++;
          logger?.info(`✅ [Step: retryNarratives] Narrative found on retry for ${race.raceName} (${narrative.length} chars)`);
        } else {
          logger?.info(`📰 [Step: retryNarratives] Still no narrative for ${race.raceName} after retry — will generate generic article`);
        }
      } catch (err: any) {
        logger?.warn(`⚠️ [Step: retryNarratives] Error retrying narrative for ${race.raceName}: ${err.message}`);
      }
    }

    logger?.info(`✅ [Step: retryNarratives] Retry complete: ${updatedCount}/${racesWithoutNarrative.length} narrative(s) found on retry`);

    const headerMatch = inputData.searchResults.match(/^(.*?)(?=## )/s);
    const header = headerMatch ? headerMatch[1] : "";
    const updatedSearchResults = header + raceBlocks.join("");

    return { found: true, searchResults: updatedSearchResults, lockAcquired };
  },
});

const generateArticlesStep = createStep({
  id: "generate-articles",
  description: "Uses the AI agent to generate comprehensive bilingual articles with SEO and social versions",
  inputSchema: z.object({
    found: z.boolean(),
    searchResults: z.string(),
    lockAcquired: z.boolean().optional(),
  }),
  outputSchema: z.object({
    noRaces: z.boolean(),
    articles: z.array(articleSchema),
    lockAcquired: z.boolean().optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const lockAcquired = inputData.lockAcquired ?? true;

    if (!inputData.found || !inputData.searchResults) {
      logger?.info("⏭️ [Step: generateArticles] No race data found, skipping");
      return { noRaces: true, articles: [], lockAcquired };
    }

    logger?.info("✍️ [Step: generateArticles] Generating articles from race data...");

    try {
      const pendingArticles = await loadPendingArticles();
      if (pendingArticles.length > 0) {
        logger?.info(`♻️ [Step: generateArticles] Found ${pendingArticles.length} pending article(s) from previous failed run — skipping generation, will publish these directly`);
        return { noRaces: false, articles: pendingArticles, lockAcquired };
      }

      const allRaceBlocks = inputData.searchResults.split(/(?=## )/).filter(block => block.trim().startsWith("## "));
      logger?.info(`📊 [Step: generateArticles] Found ${allRaceBlocks.length} individual race(s) in search results`);

      if (allRaceBlocks.length === 0) {
        logger?.info("ℹ️ [Step: generateArticles] No race blocks found in search results");
        return { noRaces: true, articles: [], lockAcquired };
      }

      const categoryPriority: Record<string, number> = {
        "UWT": 1, "WT": 1, "2.UWT": 1, "1.UWT": 1, "2.WWT": 1, "1.WWT": 1,
        "2.Pro": 2, "1.Pro": 2, "ProS": 2,
        "2.1": 3, "1.1": 3,
        "CC": 4, "NC": 5,
      };
      const majorCategories = new Set(["UWT", "WT", "2.UWT", "1.UWT", "2.WWT", "1.WWT", "2.Pro", "1.Pro", "ProS", "2.1", "1.1"]);

      let publishedRaceNames: Set<string> = new Set();
      try {
        const pool = getPool();
        await ensurePublishedArticlesTable();
        const dbResult = await pool.query("SELECT race_name FROM published_articles WHERE race_name IS NOT NULL AND race_name != ''");
        publishedRaceNames = new Set(dbResult.rows.map((r: any) => normalizeRaceName(r.race_name)));
        logger?.info(`📋 [Step: generateArticles] Found ${publishedRaceNames.size} already-published race(s) in DB — will skip article generation for these`);
      } catch (dbError) {
        logger?.warn("⚠️ [Step: generateArticles] Could not fetch published races from DB, will generate all articles", {
          error: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }

      const candidateBlocks = allRaceBlocks
        .map(block => {
          const hdr = (block.match(/^## .+/m) || [""])[0];
          const catMs = [...hdr.matchAll(/\(([^)]+)\)/g)];
          const cat = catMs.length > 0 ? catMs[catMs.length - 1][1].trim() : "unknown";
          const priority = categoryPriority[cat] ?? 3;
          const hasNarrative = block.includes("Race Narrative (from");
          const nameMatch = block.match(/^## (.+?)(?:\s*\(|$)/m);
          const raceName = normalizeRaceName(nameMatch ? nameMatch[1].trim() : "Unknown");
          const alreadyPublished = publishedRaceNames.size > 0 && publishedRaceNames.has(raceName);
          return { block, cat, priority, hasNarrative, raceName, alreadyPublished };
        })
        .filter(r => {
          if (majorCategories.has(r.cat)) return true;
          if (r.hasNarrative) return true;
          logger?.info(`⏭️ [Step: generateArticles] Skipping "${r.raceName}" (${r.cat}) — minor race without narrative`);
          return false;
        })
        .sort((a, b) => a.priority - b.priority);

      const allNewBlocks = candidateBlocks.filter(r => !r.alreadyPublished);

      // All new blocks (including 2.1/1.1) are eligible for article generation
      // 2.1/1.1 races get full articles even without a narrative (data-only article)
      const eligibleForArticle = allNewBlocks;
      const newArticleBlocks = eligibleForArticle.slice(0, 3);
      const deprioritizedBlocks = eligibleForArticle.slice(3); // beyond article cap — results uploaded now, articles in next run
      const resultsOnlyBlocks = candidateBlocks.filter(r => r.alreadyPublished);
      const deprioritizedNames = new Set(deprioritizedBlocks.map(r => r.raceName));

      const raceBlocks = [...newArticleBlocks, ...resultsOnlyBlocks, ...deprioritizedBlocks].map(r => r.block);

      logger?.info(`📊 [Step: generateArticles] Processing ${newArticleBlocks.length} new article(s) + ${resultsOnlyBlocks.length} results-only re-upload(s) + ${deprioritizedBlocks.length} deferred (results now, articles next run)`);

      const articles: any[] = [];
      const generationBudgetMs = 125000;
      const generationStart = Date.now();
      let newStyleCounter = 0; // sequential counter for style rotation — incremented per new article generated

      for (let i = 0; i < raceBlocks.length; i++) {
        const raceBlock = raceBlocks[i];
        const raceNameMatch = raceBlock.match(/^## (.+?)(?:\s*\(|$)/m);
        const raceName = normalizeRaceName(raceNameMatch ? raceNameMatch[1].trim() : "Unknown Race");

        const winnerMatch = raceBlock.match(/Winner:\s*(.+?)(?:\n|$)/m);
        const winnerFullName = winnerMatch ? winnerMatch[1].trim() : "";

        const isAlreadyPublished = publishedRaceNames.size > 0 && publishedRaceNames.has(raceName);
        const isDeprioritized = deprioritizedNames.has(raceName);

        if (isAlreadyPublished || isDeprioritized) {
          if (isAlreadyPublished) {
            logger?.info(`⏭️ [Step: generateArticles] Skipping article for "${raceName}" — already published (exact race_name match in DB)`);
          } else {
            logger?.info(`⏭️ [Step: generateArticles] Deferring article for "${raceName}" — results uploaded now, article will be generated next run`);
          }
          const rankings = parseRankingsFromBlock(raceBlock);
          const raceMeta = parseRaceMetaFromBlock(raceBlock);
          if (rankings.length > 0) {
            const todayStr = new Date().toISOString().split("T")[0];
            articles.push({
              titleIt: "", subtitleIt: "", excerptIt: "", contentIt: "",
              titleEn: "", subtitleEn: "", excerptEn: "", contentEn: "",
              slug: "", hashtags: "", winnerName: winnerFullName, raceName,
              metaDescription: "", primaryKeyword: "",
              alternativeTitles: [], socialVersion: "", instagramVersion: "",
              bulletPoints: [], styleUsed: "", structureUsed: "",
              rankings,
              stageNumber: raceMeta.stageNumber,
              isStageRace: raceMeta.isStageRace,
              isFinalGC: raceMeta.isFinalGC,
              isTTT: raceMeta.isTTT,
              startLocation: raceMeta.startLocation,
              endLocation: raceMeta.endLocation,
              raceDistance: raceMeta.raceDistance,
              raceDate: todayStr,
              raceCategory: raceMeta.raceCategory,
              resultsOnly: true,
              gcRankings: parseGCRankingsFromBlock(raceBlock),
            });
            logger?.info(`📊 [Step: generateArticles] Created results-only entry for "${raceName}" (${rankings.length} rankings, TTT=${raceMeta.isTTT}) — will re-upload results`);
          }
          continue;
        }
        // Sequential style rotation: (total published articles + new articles this run) mod 5
        const styleIndex = (publishedRaceNames.size + newStyleCounter) % 5;
        const assignedStyle = String(styleIndex + 1);
        const assignedStructure = assignedStyle;

        const hasNarrativeForLog = raceBlock.includes("Race Narrative (from");
        logger?.info(`✍️ [Step: generateArticles] [${i + 1}/${raceBlocks.length}] Generating article for: ${raceName} | Winner: ${winnerFullName} → Style ${assignedStyle} (slot ${styleIndex + 1}/5, base=${publishedRaceNames.size} published) | Narrative: ${hasNarrativeForLog ? "YES" : "NO"}`);

        // REGOLA FONDAMENTALE SUI TITOLI (vale per tutti gli stili):
        // Il titolo deve SEMPRE essere un titolo sportivo giornalistico che mette al centro
        // il vincitore e la gara (es. "Silva vince la tappa 5 di O Gran Camiño").
        // Lo stile editoriale cambia solo la PROSPETTIVA del corpo dell'articolo, MAI il titolo.

        const styleDescriptions: Record<string, string> = {
          "1": "[ANALISI TATTICA] Il corpo dell'articolo analizza le dinamiche tattiche: quando è scattato l'attacco decisivo, quali squadre hanno controllato la corsa, chi ha fatto l'andatura. Tono autorevole e tecnico. Usa verbi ciclistici precisi: 'scattare', 'fare il buco', 'scollinare', 'rilanciare', 'rientrare'. Struttura corpo: 1. La mossa tattica vincente 2. Analisi della corsa 3. Il percorso e i punti critici 4. Top 10 5. Classifica (se tappa) 6. Prospettiva tecnica",
          "2": "[LATO UMANO] Il corpo dell'articolo racconta la storia umana del vincitore e degli altri protagonisti: la fatica, i sacrifici, i momenti di crisi, il riscatto. Tono narrativo ed empatico. Verbi di determinazione: 'resistere', 'cedere terreno', 'tenere la ruota', 'rialzarsi'. Struttura corpo: 1. Il momento umano chiave 2. Cronaca empatica della gara 3. Il contesto 4. Top 10 5. Classifica (se tappa) 6. Significato della vittoria",
          "3": "[BUSINESS & MANAGEMENT] Il corpo dell'articolo aggiunge una prospettiva professionale: come la squadra ha pianificato la vittoria, il ruolo del direttore sportivo nelle scelte, il valore del risultato per la stagione del team. Tono professionale ma sempre sportivo. Struttura corpo: 1. La strategia del team 2. Cronaca della gara 3. Il ruolo del DS e delle ammiraglie 4. Top 10 5. Classifica (se tappa) 6. Impatto del risultato sulla stagione",
          "4": "[FLASH NEWS] Articolo rapido e sintetico. Frasi corte, fatti diretti, nessuna retorica. Usa bullet points (<ul><li>) per i punti chiave della gara e per la Top 10. Struttura corpo: 1. Sintesi in 2-3 righe 2. Punti chiave della gara (bullet) 3. Top 10 (lista) 4. Classifica (se tappa) 5. Il Dettaglio Extra in un paragrafo breve",
          "5": "[TECH & INSIDER] Il corpo dell'articolo aggiunge un focus tecnico: le caratteristiche del percorso (pavé, sterrato, pendenze), le scelte di materiale e alimentazione, i dettagli del finale. Tono curioso e specialistico. Struttura corpo: 1. L'insight tecnico principale 2. Cronaca con dettagli tecnici 3. Il percorso in chiave tecnica 4. Top 10 5. Classifica (se tappa) 6. Curiosità tecnica finale",
        };

        const structureDescriptions: Record<string, string> = {
          "1": "ANALISI TATTICA: titolo sportivo → mossa tattica vincente → analisi della corsa → Top 10 → prospettiva tecnica",
          "2": "LATO UMANO: titolo sportivo → momento umano → cronaca empatica → Top 10 → significato della vittoria",
          "3": "BUSINESS & MANAGEMENT: titolo sportivo → strategia del team → cronaca → Top 10 → impatto sulla stagione",
          "4": "FLASH NEWS: titolo sportivo → sintesi rapida → bullet points gara → Top 10 → Dettaglio Extra",
          "5": "TECH & INSIDER: titolo sportivo → insight tecnico → cronaca tecnica → Top 10 → curiosità finale",
        };

        const hasNarrative = raceBlock.includes("Race Narrative (from");
        const isFinalGC = raceBlock.includes("Type: Final General Classification");

        const MAX_NARRATIVE_CHARS = 2000;
        const truncatedBlock = raceBlock.replace(
          /(Race Narrative \(from [^)]+\):\n)([\s\S]+?)(\n(?:General Classification|GC Classification|## |$))/,
          (_full, header, narr, tail) => {
            if (narr.length <= MAX_NARRATIVE_CHARS) return `${header}${narr}${tail}`;
            return `${header}${narr.slice(0, MAX_NARRATIVE_CHARS)}\n[...]\n${tail}`;
          }
        );

        const currentYear = new Date().getFullYear();
        const todayDateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

        const prompt = `⚠️ ANNO CORRENTE: ${currentYear} — Oggi è ${todayDateStr}. TUTTE le date, stagioni e anni negli articoli DEVONO usare ${currentYear}. MAI usare anni precedenti come 2023, 2024, 2025 salvo citazioni storiche esplicite.

Ecco i risultati completi di UNA SINGOLA gara ciclistica terminata oggi (${todayDateStr}), con tutti i dati disponibili:

${truncatedBlock}

${isFinalGC ? `ARTICOLO SULLA CLASSIFICA GENERALE FINALE:
Questo è un articolo DEDICATO alla classifica generale finale di una corsa a tappe.
NON è un articolo di tappa — concentrati sul VINCITORE FINALE della corsa, la sua prestazione complessiva durante tutta la corsa, l'analisi della classifica generale top 10, e il significato della vittoria.
Includi: bilancio della corsa, prestazione del vincitore, distacchi in classifica, analisi dei rivali, e cosa significa questa vittoria per la stagione del corridore.
` : ''}Genera UN SINGOLO articolo COMPLETO e DETTAGLIATO per questa gara.
L'articolo deve avere MINIMO 1000 parole con contenuto HTML ben formattato.

STILE OBBLIGATORIO: ${styleDescriptions[assignedStyle]}
STRUTTURA OBBLIGATORIA: ${structureDescriptions[assignedStructure]}
Nel JSON usa styleUsed: "${assignedStyle}" e structureUsed: "${assignedStructure}"

⚠️ REGOLA TITOLI (CRITICA — vale per TUTTI gli stili):
Il titolo (titleIt, titleEn) deve essere SEMPRE un headline sportivo giornalistico che racconta il risultato della gara.
Formato corretto: "[Vincitore] [verbo azione] [gara/tappa]" — esempi:
  ✅ "Silva conquista la quinta tappa di O Gran Camiño"
  ✅ "Tóth vince la volata e apre il Tour of Hainan"
  ✅ "Dominio van Aert alla Liegi: fuga da lontano e nessuno lo raggiunge"
  ❌ "Strategia commerciale del team nella quinta tappa" — VIETATO
  ❌ "Analisi tattica dell'attacco decisivo" — VIETATO
  ❌ "Gestione delle risorse umane in corsa" — VIETATO
Il TITOLO riguarda sempre il VINCITORE e la GARA. Lo stile editoriale cambia solo il CORPO dell'articolo.

REGOLE LINGUISTICHE OBBLIGATORIE:
- VIETATO usare aggettivi generici: "fantastico", "incredibile", "straordinario", "spettacolare", "eccezionale". Sostituiscili con descrizioni precise dei fatti.
- USA verbi di movimento specifici del ciclismo: "scattare", "fare il buco", "scollinare", "rilanciare", "rientrare sul gruppo", "cedere terreno", "tenere la ruota", "andare in fuga", "tagliare il traguardo", "resistere agli attacchi".
- Varia il vocabolario: usa sinonimi diversi per evitare ripetizioni.

IL DETTAGLIO EXTRA (obbligatorio in ogni articolo):
Aggiungi un paragrafo finale prima del box SEO intitolato <h2>Il Dettaglio Extra</h2> che offra UN punto di vista originale tra questi (scegli quello più pertinente ai dati disponibili):
- Il ruolo decisivo di un gregario nella vittoria
- Un dato tecnico o statistico che cambia la lettura della gara
- Il significato di questa vittoria per la stagione del corridore
- Un confronto con un'edizione precedente (SOLO se verificabile dai dati forniti)
NON inventare: se non hai dati sufficienti per uno spunto originale, commenta la tattica di squadra o il valore del risultato in classifica.

${hasNarrative ? `CRONACA DELLA GARA - REGOLA CRITICA:
Sopra è presente una "Race Narrative" con la cronaca reale della gara da una fonte esterna.
DEVI basare la sezione "Cronaca della gara / Race Report" su quei fatti reali.
Integra nel tuo articolo: fughe, attacchi, momenti chiave, strategie di squadra, dichiarazioni dei corridori — tutto ciò che è presente nella narrative.
ARTICOLO ESCLUSIVO: NON copiare frasi dalla fonte. RIELABORA i fatti con le tue parole e il tuo stile giornalistico assegnato. Racconta la stessa storia a modo tuo.
NON inventare dettagli aggiuntivi che non sono nella narrative o nei dati della classifica.
Le citazioni dei corridori vanno usate SOLO se presenti nella narrative — MAI inventarne.` : `ATTENZIONE: Non è disponibile una cronaca dettagliata della gara da fonti esterne.
Descrivi la gara in modo GENERICO basandoti SOLO sui dati della classifica (posizioni, tempi, distacchi).
NON inventare una cronaca dettagliata, fughe, attacchi o dichiarazioni.
Concentrati su: analisi dei risultati, percorso, e significato della vittoria.`}

DATI DISPONIBILI DA USARE:
- Usa i dati di distanza, percorso, velocità media e dislivello SE presenti sopra
- Usa la classifica SOLO Top 10 nell'articolo con <ol> e <li> (MAI più di 10 posizioni)
- Usa la classifica generale (GC) SE presente per le corse a tappe
- Se un dato non è presente, scrivi "informazione non disponibile sulla fonte" o omettilo

CORRIDORI ITALIANI — REGOLA EDITORIALE:
- Se nella classifica o nella narrativa è presente uno o più corridori italiani, DEVI valorizzarli in modo più approfondito rispetto agli altri.
- Per ogni italiano presente nella Top 10: commenta la sua prestazione, cita la squadra, e metti in prospettiva il risultato (es. miglior piazzamento stagionale, rivalità, ambizioni future).
- Se un italiano ha vinto o è salito sul podio: dedica una sezione specifica alla sua vittoria/podio con tono entusiasta e patriottico, senza però inventare dettagli.
- Se nessun italiano è presente nella top 10 ma è citato nella narrativa (fuga, attacco, ruolo di gregario): menzionalo comunque con un paragrafo dedicato.
- Nelle versioni social (socialVersion, instagramVersion): se c'è un italiano nel podio, menzionalo sempre con nome e bandiera 🇮🇹.
- Questa regola si applica solo se i dati lo confermano — NON inventare prestazioni italiane inesistenti.

TRADUZIONE INGLESE - OBBLIGATORIO:
- contentEn DEVE essere una traduzione COMPLETA e INTEGRALE di contentIt
- OGNI sezione, OGNI paragrafo, OGNI frase in italiano DEVE essere tradotta in inglese
- contentEn deve avere la STESSA lunghezza e lo STESSO dettaglio di contentIt
- NON abbreviare, riassumere o omettere parti nella versione inglese
- Anche titleEn, subtitleEn, excerptEn devono essere traduzioni complete

REGOLE CRITICHE:
- Usa SOLO i dati reali forniti sopra. NON inventare risultati, tempi, distacchi o dichiarazioni
- Se un dato non esiste, scrivi "informazione non disponibile sulla fonte"
- ANNO OBBLIGATORIO: scrivi sempre "${currentYear}" come anno della stagione ciclistica in corso — MAI anni precedenti
- winnerName nel formato "Nome Cognome" (es. "Mauro Schmid", NON "SCHMID Mauro")
- slug DEVE essere SEMPRE in italiano con l'anno corrente ${currentYear} (es. "nome-gara-${currentYear}-risultati" o "nome-gara-${currentYear}-tappa-5-risultati"). MAI usare parole inglesi come "results" o "stage" nello slug - usa SEMPRE "risultati" e "tappa". REGOLA SLUG CATEGORIA: se il nome della gara contiene suffissi di categoria (ME, MJ, WE, WJ, U23, Elite, Junior, Juniores, Under, Women, Donne), DEVI SEMPRE includerli nello slug — esempi: "E3 Saxo Classic MJ" → "e3-saxo-classic-mj-${currentYear}-risultati"; "GP Plouay WE" → "gp-plouay-we-${currentYear}-risultati"; "Campionato Nazionale U23" → "campionato-nazionale-u23-${currentYear}-risultati"
- raceName deve essere ESATTAMENTE "${raceName}"
- metaDescription: MAX 140 caratteri, basata esclusivamente sui fatti riportati (NON frasi pubblicitarie)
- hashtags: ESATTAMENTE 3 tag pertinenti con il simbolo # (es. "#WorldTour", "#Ciclismo", "#AnalisiTattica") — scegli tag specifici per questa gara/stile
- socialVersion max 400 caratteri con emoji
- instagramVersion max 150 caratteri
- bulletPoints: esattamente 8 punti
- alternativeTitles: esattamente 5 titoli

Rispondi ESCLUSIVAMENTE con JSON valido (no markdown, no backtick, no commenti).`;

        const elapsedBeforeGen = Date.now() - generationStart;
        if (elapsedBeforeGen > generationBudgetMs) {
          logger?.warn(`⏱️ [Step: generateArticles] Generation budget (${generationBudgetMs / 1000}s) exceeded after ${(elapsedBeforeGen / 1000).toFixed(1)}s — skipping remaining new articles`);
          break;
        }

        try {
          const startTime = Date.now();
          const response = await generateWithTimeout(prompt, 115000);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

          logger?.info(`📄 [Step: generateArticles] Response for ${raceName}: ${response.text.length} chars in ${elapsed}s`);

          let parsed;
          try {
            let text = response.text.trim();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) text = jsonMatch[0];
            parsed = JSON.parse(text);
          } catch (parseError) {
            logger?.error(`❌ [Step: generateArticles] Failed to parse JSON for ${raceName}`, {
              rawText: response.text.substring(0, 500),
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
            continue;
          }

          const contentItLen = (parsed.contentIt || "").length;
          const contentEnLen = (parsed.contentEn || "").length;
          if (contentEnLen < contentItLen * 0.7) {
            logger?.warn(`⚠️ [Step: generateArticles] English content (${contentEnLen} chars) is much shorter than Italian (${contentItLen} chars) for ${raceName} - translation may be incomplete`);
          }

          const rankings = parseRankingsFromBlock(raceBlock);
          const raceMeta = parseRaceMetaFromBlock(raceBlock);
          const todayStr = new Date().toISOString().split("T")[0];

          articles.push({
            titleIt: parsed.titleIt || "",
            subtitleIt: parsed.subtitleIt || "",
            excerptIt: parsed.excerptIt || "",
            contentIt: parsed.contentIt || "",
            titleEn: parsed.titleEn || "",
            subtitleEn: parsed.subtitleEn || "",
            excerptEn: parsed.excerptEn || "",
            contentEn: parsed.contentEn || "",
            slug: (parsed.slug || "").replace(/\-results/g,'-risultati').replace(/\bstage\-(\d+)/g,'tappa-$1').replace(/\-result\b/g,'-risultati'),
            hashtags: parsed.hashtags || "",
            winnerName: parsed.winnerName || "",
            raceName: parsed.raceName || raceName,
            metaDescription: parsed.metaDescription || "",
            primaryKeyword: parsed.primaryKeyword || "",
            alternativeTitles: Array.isArray(parsed.alternativeTitles) ? parsed.alternativeTitles : [],
            socialVersion: parsed.socialVersion || "",
            instagramVersion: parsed.instagramVersion || "",
            bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints : [],
            styleUsed: parsed.styleUsed || "",
            structureUsed: parsed.structureUsed || "",
            rankings,
            stageNumber: raceMeta.stageNumber,
            isStageRace: raceMeta.isStageRace,
            isFinalGC: raceMeta.isFinalGC,
            isTTT: raceMeta.isTTT,
            startLocation: raceMeta.startLocation,
            endLocation: raceMeta.endLocation,
            raceDistance: raceMeta.raceDistance,
            raceDate: todayStr,
            raceCategory: raceMeta.raceCategory,
            gcRankings: parseGCRankingsFromBlock(raceBlock),
          });

          const gcRankingsParsed = parseGCRankingsFromBlock(raceBlock);
          logger?.info(`📊 [Step: generateArticles] Race meta for ${raceName}: rankings=${rankings.length}, stage=${raceMeta.stageNumber}, stageRace=${raceMeta.isStageRace}, GC=${raceMeta.isFinalGC}, TTT=${raceMeta.isTTT}, gcRankings=${gcRankingsParsed.length}`);

          logger?.info(`✅ [Step: generateArticles] [${i + 1}/${raceBlocks.length}] Article generated for ${raceName} | Style: ${parsed.styleUsed || "?"} | Structure: ${parsed.structureUsed || "?"} | IT: ${contentItLen} chars | EN: ${contentEnLen} chars`);
          newStyleCounter++; // advance sequential style counter only on successful generation
        } catch (error) {
          logger?.error(`❌ [Step: generateArticles] Error generating article for ${raceName} (continuing with next race)`, {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }

      logger?.info(`✅ [Step: generateArticles] Generated ${articles.length}/${raceBlocks.length} article(s) total`);

      const articlesToPublish = articles.filter(a => !a.resultsOnly);
      if (articlesToPublish.length > 0) {
        try {
          await savePendingArticles(articlesToPublish);
          logger?.info(`💾 [Step: generateArticles] Saved ${articlesToPublish.length} article(s) to pending_articles DB (will be cleared after publish)`);
        } catch (dbErr) {
          logger?.warn(`⚠️ [Step: generateArticles] Could not save pending articles to DB: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
        }
      }

      return { noRaces: articles.length === 0, articles, lockAcquired };
    } catch (error) {
      logger?.error("❌ [Step: generateArticles] Critical error", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { noRaces: true, articles: [], lockAcquired };
    }
  },
});

const publishStep = createStep({
  id: "login-and-publish",
  description: "Logs into Radiociclismo and creates draft articles scheduled 1 hour later with SEO metadata",
  inputSchema: z.object({
    noRaces: z.boolean(),
    articles: z.array(articleSchema),
    lockAcquired: z.boolean().optional(),
  }),
  outputSchema: z.object({
    published: z.boolean(),
    articlesPublished: z.number(),
    message: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const lockAcquired = inputData.lockAcquired ?? true;

    async function tryReleaseLock() {
      if (!lockAcquired) return;
      try {
        await releaseWorkflowLock();
        logger?.info("🔓 [Step: loginAndPublish] Workflow lock released");
      } catch (lockErr: any) {
        logger?.warn(`⚠️ [Step: loginAndPublish] Could not release workflow lock: ${lockErr.message}`);
      }
    }

    if (inputData.noRaces || inputData.articles.length === 0) {
      logger?.info("⏭️ [Step: loginAndPublish] No articles to publish");
      await tryReleaseLock();
      return { published: false, articlesPublished: 0, message: "No races finished today" };
    }

    logger?.info(
      `🔐 [Step: loginAndPublish] Logging into Radiociclismo to create ${inputData.articles.length} article(s) scheduled +1h...`,
    );

    try {
      const username = process.env.RC_USERNAME;
      const password = process.env.RC_PASSWORD;

      if (!username || !password) {
        logger?.error("❌ [Step: loginAndPublish] Missing RC_USERNAME or RC_PASSWORD");
        await tryReleaseLock();
        return { published: false, articlesPublished: 0, message: "Missing credentials" };
      }

      logger?.info("🔐 [Step: loginAndPublish] Attempting login...");

      const loginResponse = await axios.post(
        "https://radiociclismo.com/api/admin/login",
        { username, password },
        {
          headers: { "Content-Type": "application/json" },
          withCredentials: true,
          maxRedirects: 0,
          validateStatus: (s) => s < 400,
          timeout: 15000,
        },
      );

      const cookies = loginResponse.headers["set-cookie"] || [];
      let sessionCookie = "";
      for (const cookie of cookies) {
        if (cookie.includes("connect.sid")) {
          sessionCookie = cookie.split(";")[0];
          break;
        }
      }
      if (!sessionCookie && cookies.length > 0) {
        sessionCookie = cookies[0].split(";")[0];
      }

      if (!sessionCookie) {
        logger?.error("❌ [Step: loginAndPublish] Login failed - no session cookie received", {
          status: loginResponse.status,
          headers: JSON.stringify(loginResponse.headers),
        });
        await tryReleaseLock();
        return { published: false, articlesPublished: 0, message: "Login failed - no session cookie" };
      }

      logger?.info("✅ [Step: loginAndPublish] Login successful");

      let rcRaces: Array<{ id: number; slug: string; title: string; resultsToken: string; category: string; isStageRace: boolean; startDate: string; endDate: string | null }> = [];
      try {
        const racesResponse = await axios.get("https://radiociclismo.com/api/admin/races", {
          headers: { Cookie: sessionCookie },
          timeout: 15000,
        });
        rcRaces = (racesResponse.data || []).map((r: any) => ({
          id: r.id,
          slug: r.slug,
          title: r.title,
          resultsToken: r.resultsToken,
          category: r.category,
          isStageRace: r.isStageRace || false,
          startDate: r.startDate || "",
          endDate: r.endDate || null,
        }));
        logger?.info(`🏁 [Step: loginAndPublish] Loaded ${rcRaces.length} races from Radiociclismo portal`);
      } catch (rcErr) {
        logger?.warn(`⚠️ [Step: loginAndPublish] Could not load races from portal: ${rcErr instanceof Error ? rcErr.message : String(rcErr)}`);
      }

      let publishedSlugs: Set<string> = new Set();
      let existingTitles: string[] = [];
      let slugToRaceName: Map<string, string> = new Map();
      let hasRaceNameData = false;
      try {
        const pool = getPool();
        await ensurePublishedArticlesTable();
        const dbResult = await pool.query("SELECT slug, title_it, race_name FROM published_articles");
        publishedSlugs = new Set(dbResult.rows.map((r: any) => r.slug));
        existingTitles = dbResult.rows.map((r: any) => r.title_it || "").filter(Boolean);
        slugToRaceName = new Map(dbResult.rows.map((r: any) => [r.slug, r.race_name || ""]));
        hasRaceNameData = true;
        logger?.info(`📋 [Step: loginAndPublish] Found ${publishedSlugs.size} previously published slug(s) in DB for dedup`);
      } catch (dbError) {
        logger?.warn("⚠️ [Step: loginAndPublish] Could not fetch published slugs from DB, trying site API fallback", {
          error: dbError instanceof Error ? dbError.message : String(dbError),
        });
        try {
          const existingResponse = await axios.get(
            "https://radiociclismo.com/api/admin/articles",
            {
              headers: { Cookie: sessionCookie },
              timeout: 15000,
            },
          );
          const existingArticles = existingResponse.data || [];
          publishedSlugs = new Set(existingArticles.map((a: any) => a.slug));
          existingTitles = existingArticles.map((a: any) => a.title || "").filter(Boolean);
          logger?.info(`📋 [Step: loginAndPublish] Fallback: Found ${publishedSlugs.size} existing article(s) on site`);
        } catch (err2) {
          logger?.warn("⚠️ [Step: loginAndPublish] Could not fetch existing articles either, proceeding without dedup", {
            error: err2 instanceof Error ? err2.message : String(err2),
          });
        }
      }

      let articlesPublished = 0;
      const messages: string[] = [];
      const uploadedRcRaceIds = new Set<number>(); // Prevents lower-category races from overwriting results already uploaded by a higher-priority race
      const gcUploadedStages = new Map<number, number>(); // rcRaceId → max stage number for which GC was uploaded (prevents older stages from overwriting newer GC)

      for (const article of inputData.articles) {
        if (article.resultsOnly) {
          logger?.info(`📊 [Step: loginAndPublish] Results-only entry for "${article.raceName}" — skipping article creation, uploading results`);
          if (article.rankings && article.rankings.length > 0 && rcRaces.length > 0) {
            try {
              await uploadResultsToRace(article, sessionCookie, rcRaces, logger, uploadedRcRaceIds, gcUploadedStages);
              messages.push(`Results updated for "${article.raceName}"`);
            } catch (uploadErr) {
              logger?.warn(`⚠️ [Step: loginAndPublish] Could not upload results for "${article.raceName}": ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
              messages.push(`Failed to update results for "${article.raceName}"`);
            }
          }
          continue;
        }

        let effectiveArticle = article;

        if (publishedSlugs.has(article.slug)) {
          const existingRaceName = normalizeRaceName(slugToRaceName.get(article.slug) || "");
          const currentRaceName = normalizeRaceName(article.raceName || "");
          // Only attempt alternative slug when race_name data is reliable (DB loaded OK).
          // In API-fallback mode (hasRaceNameData=false), conservatively treat all collisions
          // as same-race to avoid creating duplicate articles with -2 suffix.
          // Within DB mode: empty existingRaceName = just published in this run → try alternative.
          const isDifferentRace = hasRaceNameData &&
            (!existingRaceName || (currentRaceName && existingRaceName !== currentRaceName));

          if (isDifferentRace) {
            let resolvedSlug: string | null = null;
            for (let i = 2; i <= 5; i++) {
              const candidateSlug = `${article.slug}-${i}`;
              if (!publishedSlugs.has(candidateSlug)) {
                resolvedSlug = candidateSlug;
                break;
              }
            }
            if (resolvedSlug) {
              logger?.info(`🔄 [Step: loginAndPublish] Slug collision tra gare diverse — uso slug alternativo "${resolvedSlug}" (era: "${article.slug}"). Gara esistente: "${existingRaceName}", nuova gara: "${currentRaceName}"`);
              effectiveArticle = { ...article, slug: resolvedSlug };
            } else {
              logger?.warn(`⚠️ [Step: loginAndPublish] Impossibile trovare slug alternativo per "${article.raceName}" — tutti i suffissi -2/-5 già usati, articolo saltato`);
              if (article.rankings && article.rankings.length > 0 && rcRaces.length > 0) {
                try {
                  await uploadResultsToRace(article, sessionCookie, rcRaces, logger, uploadedRcRaceIds, gcUploadedStages);
                  messages.push(`Results overwritten for "${article.raceName}" (no slug available)`);
                } catch (uploadErr) {
                  logger?.warn(`⚠️ [Step: loginAndPublish] Could not overwrite results: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
                }
              }
              messages.push(`Skipped "${article.titleIt}" (slug esaurito)`);
              continue;
            }
          } else {
            logger?.info(`⏭️ [Step: loginAndPublish] Skipping article "${article.titleIt}" - slug "${article.slug}" già pubblicato per stessa gara "${existingRaceName}"`);
            if (article.rankings && article.rankings.length > 0 && rcRaces.length > 0) {
              logger?.info(`📊 [Step: loginAndPublish] Slug collision (stessa gara) — ricarico comunque i risultati per "${article.raceName}"`);
              try {
                await uploadResultsToRace(article, sessionCookie, rcRaces, logger, uploadedRcRaceIds, gcUploadedStages);
                messages.push(`Results overwritten for "${article.raceName}" (slug already existed)`);
              } catch (uploadErr) {
                logger?.warn(`⚠️ [Step: loginAndPublish] Could not overwrite results for "${article.raceName}": ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
              }
            }
            messages.push(`Skipped "${article.titleIt}" (already published)`);
            continue;
          }
        }

        const isDuplicate = checkTitleOverlap(article.titleIt, existingTitles, article.raceName);
        if (isDuplicate) {
          logger?.info(`⏭️ [Step: loginAndPublish] Skipping "${article.titleIt}" - title overlap with existing article`);
          if (article.rankings && article.rankings.length > 0 && rcRaces.length > 0) {
            logger?.info(`📊 [Step: loginAndPublish] Title overlap — still uploading results for "${article.raceName}" to overwrite any previous incorrect results`);
            try {
              await uploadResultsToRace(article, sessionCookie, rcRaces, logger, uploadedRcRaceIds, gcUploadedStages);
              messages.push(`Results overwritten for "${article.raceName}" (title overlap)`);
            } catch (uploadErr) {
              logger?.warn(`⚠️ [Step: loginAndPublish] Could not overwrite results for "${article.raceName}": ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
            }
          }
          messages.push(`Skipped "${article.titleIt}" (title overlap)`);
          continue;
        }

        try {
          logger?.info(`📝 [Step: loginAndPublish] Creating article: ${effectiveArticle.titleIt} (slug: ${effectiveArticle.slug})`);

          const hashtagList = effectiveArticle.hashtags
            ? effectiveArticle.hashtags.split(",").map((h: string) => h.trim().replace(/^#/, ""))
            : [];

          const contentWithSeo = buildContentWithExtras(effectiveArticle);

          const publishAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

          const articleData = {
            slug: effectiveArticle.slug,
            title: effectiveArticle.titleIt,
            excerpt: effectiveArticle.excerptIt,
            content: contentWithSeo.contentIt,
            titleEn: effectiveArticle.titleEn,
            excerptEn: effectiveArticle.excerptEn,
            contentEn: contentWithSeo.contentEn,
            author: "Radiociclismo Report",
            publishAt,
            coverImageUrl: null,
            images: [],
            hashtags: hashtagList,
            metaDescription: effectiveArticle.metaDescription || "",
            subtitle: effectiveArticle.subtitleIt || "",
            subtitleEn: effectiveArticle.subtitleEn || "",
          };

          logger?.info(`🕐 [Step: loginAndPublish] Scheduled publish at: ${publishAt}`);

          let createResponse: any;
          let usedSlug = articleData.slug;
          try {
            createResponse = await axios.post(
              "https://radiociclismo.com/api/admin/articles",
              articleData,
              {
                headers: { "Content-Type": "application/json", Cookie: sessionCookie },
                timeout: 30000,
              },
            );
          } catch (firstErr: any) {
            const firstErrMsg = firstErr?.response?.data
              ? JSON.stringify(firstErr.response.data)
              : firstErr instanceof Error ? firstErr.message : String(firstErr);
            if (firstErrMsg.includes("duplicate") || firstErrMsg.includes("unique")) {
              logger?.warn(`⚠️ [Step: loginAndPublish] Slug "${usedSlug}" conflict on RC — retrying with -v2 suffix`);
              usedSlug = articleData.slug + "-v2";
              createResponse = await axios.post(
                "https://radiociclismo.com/api/admin/articles",
                { ...articleData, slug: usedSlug },
                {
                  headers: { "Content-Type": "application/json", Cookie: sessionCookie },
                  timeout: 30000,
                },
              );
              effectiveArticle = { ...effectiveArticle, slug: usedSlug };
              logger?.info(`✅ [Step: loginAndPublish] Retry with slug "${usedSlug}" succeeded`);
            } else {
              throw firstErr;
            }
          }

          const articleId =
            createResponse.data?.id ||
            createResponse.data?._id ||
            String(createResponse.data);

          logger?.info(`✅ [Step: loginAndPublish] Article created, ID: ${articleId}`);
          logger?.info(`🕐 [Step: loginAndPublish] Will auto-publish at ${publishAt} — upload cover image before then`);
          if (effectiveArticle.socialVersion) {
            logger?.info(`📱 [Step: loginAndPublish] Social version: ${effectiveArticle.socialVersion.substring(0, 100)}...`);
          }

          articlesPublished++;
          publishedSlugs.add(effectiveArticle.slug);
          slugToRaceName.set(effectiveArticle.slug, normalizeRaceName(effectiveArticle.raceName || ""));
          existingTitles.push(effectiveArticle.titleIt);

          try {
            const pool = getPool();
            await pool.query(
              "INSERT INTO published_articles (slug, title_it, race_name) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING",
              [effectiveArticle.slug, effectiveArticle.titleIt, normalizeRaceName(effectiveArticle.raceName || "")],
            );
            logger?.info(`💾 [Step: loginAndPublish] Slug saved to DB: ${effectiveArticle.slug}`);
          } catch (dbErr) {
            logger?.warn(`⚠️ [Step: loginAndPublish] Could not save slug to DB (non-critical): ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
          }

          try {
            await removePendingArticle(effectiveArticle.raceName || "");
            logger?.info(`🗑️ [Step: loginAndPublish] Removed from pending_articles: ${effectiveArticle.raceName}`);
          } catch (pendingErr) {
            logger?.warn(`⚠️ [Step: loginAndPublish] Could not remove from pending_articles (non-critical): ${pendingErr instanceof Error ? pendingErr.message : String(pendingErr)}`);
          }

          if (effectiveArticle.rankings && effectiveArticle.rankings.length > 0 && rcRaces.length > 0) {
            try {
              await uploadResultsToRace(effectiveArticle, sessionCookie, rcRaces, logger, uploadedRcRaceIds, gcUploadedStages);
            } catch (uploadErr) {
              logger?.warn(`⚠️ [Step: loginAndPublish] Could not upload results for "${effectiveArticle.raceName}" (non-critical): ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
            }
          }

          messages.push(`"${effectiveArticle.titleIt}" created (ID: ${articleId}, scheduled ${publishAt})`);
        } catch (error: any) {
          const errMsg = error?.response?.data
            ? JSON.stringify(error.response.data)
            : error instanceof Error
              ? error.message
              : String(error);
          logger?.error(`❌ [Step: loginAndPublish] Error with article "${effectiveArticle.titleIt}" (slug: ${effectiveArticle.slug})`, {
            error: errMsg,
            status: error?.response?.status,
          });
          messages.push(`Failed to publish "${effectiveArticle.titleIt}": ${errMsg}`);
        }
      }

      try {
        await clearPendingArticles();
        logger?.info("🧹 [Step: loginAndPublish] Cleared all pending_articles (publish step completed)");
      } catch (clearErr) {
        logger?.warn(`⚠️ [Step: loginAndPublish] Could not clear pending_articles (non-critical): ${clearErr instanceof Error ? clearErr.message : String(clearErr)}`);
      }

      await tryReleaseLock();

      return {
        published: articlesPublished > 0,
        articlesPublished,
        message: messages.join("; "),
      };
    } catch (error: any) {
      const errMsg = error?.response?.data
        ? JSON.stringify(error.response.data)
        : error instanceof Error
          ? error.message
          : String(error);
      logger?.error("❌ [Step: loginAndPublish] Login error", {
        error: errMsg,
        stack: error instanceof Error ? error.stack : undefined,
      });
      await tryReleaseLock();
      return {
        published: false,
        articlesPublished: 0,
        message: `Login failed: ${errMsg}`,
      };
    }
  },
});

function checkTitleOverlap(newTitle: string, existingTitles: string[], raceName: string): boolean {
  const stopWords = new Set([
    "trionfa", "nella", "nella", "della", "dello", "degli", "delle",
    "tappa", "stage", "risultati", "results", "2024", "2025", "2026", "2027",
    "tour", "giro", "vuelta", "prima", "seconda", "terza", "quarta", "quinta",
    "sesta", "settima", "ottava", "nona", "decima",
    "analisi", "tecnica", "domina", "vince", "conquista", "vittoria",
    "asian", "continental", "championships", "national", "campionati",
    "road", "race", "volta", "ruta", "ciclista",
    "finale", "final", "regina",
  ]);

  const ordinalMap: Record<string, number> = {
    prima: 1, primo: 1, first: 1,
    seconda: 2, secondo: 2, second: 2,
    terza: 3, terzo: 3, third: 3,
    quarta: 4, quarto: 4, fourth: 4,
    quinta: 5, quinto: 5, fifth: 5,
    sesta: 6, sesto: 6, sixth: 6,
    settima: 7, settimo: 7, seventh: 7,
    ottava: 8, ottavo: 8, eighth: 8,
    nona: 9, nono: 9, ninth: 9,
    decima: 10, decimo: 10, tenth: 10,
    undicesima: 11, undicesimo: 11, eleventh: 11,
    dodicesima: 12, dodicesimo: 12, twelfth: 12,
    tredicesima: 13, tredicesimo: 13, thirteenth: 13,
    quattordicesima: 14, quattordicesimo: 14, fourteenth: 14,
    quindicesima: 15, quindicesimo: 15, fifteenth: 15,
    sedicesima: 16, sedicesimo: 16, sixteenth: 16,
    diciassettesima: 17, diciassettesimo: 17, seventeenth: 17,
    diciottesima: 18, diciottesimo: 18, eighteenth: 18,
    diciannovesima: 19, diciannovesimo: 19, nineteenth: 19,
    ventesima: 20, ventesimo: 20, twentieth: 20,
    ventunesima: 21, ventunesimo: 21,
  };
  const extractStageNum = (t: string): number | null => {
    const tLower = t.toLowerCase();
    if ((tLower.includes("tappa finale") || tLower.includes("final stage") || tLower.includes("tappa regina"))) {
      return 999;
    }
    const digitMatch = t.match(/(?:tappa|stage)\s*(\d+)/i);
    if (digitMatch) return parseInt(digitMatch[1], 10);
    const ordinalMatch = t.match(/(\w+)\s+tappa/i);
    if (ordinalMatch && ordinalMap[ordinalMatch[1].toLowerCase()]) {
      return ordinalMap[ordinalMatch[1].toLowerCase()];
    }
    for (const [word, num] of Object.entries(ordinalMap)) {
      if (tLower.includes(word) && tLower.includes("tappa")) {
        return num;
      }
    }
    if (tLower.includes("tappa") || tLower.includes("stage")) {
      return -1;
    }
    return null;
  };

  const newStage = extractStageNum(newTitle);
  const newWords = newTitle.toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w));
  if (newWords.length === 0) return false;

  for (const existingTitle of existingTitles) {
    const existingStage = extractStageNum(existingTitle);
    if (newStage !== null && existingStage !== null && newStage !== existingStage) {
      continue;
    }

    const existingWords = existingTitle.toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w));
    if (existingWords.length === 0) continue;
    const overlap = newWords.filter(w => existingWords.includes(w)).length;
    const overlapRatio = overlap / Math.max(newWords.length, 1);
    if (overlapRatio >= 0.75) return true;
  }
  return false;
}

const WOMEN_KEYWORDS = ["women", "women's", "ladies", "femenina", "femminile", "femmes", "féminin", "donne", "dames", "bike race"];
const YOUTH_KEYWORDS = ["next gen", "u23", "under 23", "under-23", "junior", "juniores", "esordienti", "allieve", "allievi"];

function isWomenRace(text: string): boolean {
  const lower = text.toLowerCase();
  if (WOMEN_KEYWORDS.some(k => lower.includes(k))) return true;
  // Cycling-specific women's category suffixes: WE (Women Elite), WJ (Women Junior), WWT (Women WorldTour)
  // Use word-boundary regex on original text (always uppercase in race names) to avoid false positives
  if (/\b(WE|WJ|WWT|1\.WWT|2\.WWT)\b/.test(text)) return true;
  return false;
}

function isYouthRace(text: string): boolean {
  const lower = text.toLowerCase();
  return YOUTH_KEYWORDS.some(k => lower.includes(k));
}

function findMatchingRace(
  raceName: string,
  rcRaces: Array<{ id: number; slug: string; title: string; resultsToken: string; category: string; isStageRace: boolean; startDate: string; endDate: string | null }>,
): { id: number; slug: string; title: string; resultsToken: string; isStageRace: boolean } | null {
  const cleanName = raceName
    .replace(/\s+\d{4}\s+Stage\s+\d+\s+results?/i, "")
    .replace(/\s*\d{4}\s*-?\s*Classifica\s+Generale\s+Finale/i, "")
    .replace(/\s+classifica\s+generale\s*(finale)?/i, "")
    .replace(/\s+results?$/i, "")
    .replace(/\s+\d{4}\s*$/, "")
    .trim();

  const sourceIsWomen = isWomenRace(raceName);
  const nameWords = cleanName.toLowerCase().split(/[\s\-]+/).filter(w => w.length >= 3);

  let bestMatch: typeof rcRaces[0] | null = null;
  let bestScore = 0;

  for (const race of rcRaces) {
    const raceTitle = race.title.toLowerCase();
    const raceSlug = race.slug.toLowerCase();

    const targetIsWomen = isWomenRace(race.title) || isWomenRace(race.slug);
    if (sourceIsWomen !== targetIsWomen) {
      continue;
    }

    const sourceIsYouth = isYouthRace(raceName);
    const targetIsYouth = isYouthRace(race.title) || isYouthRace(race.slug);
    if (sourceIsYouth !== targetIsYouth) {
      continue;
    }

    const normalizedClean = cleanName.toLowerCase().replace(/[''`]/g, "").replace(/\s+/g, " ");
    const normalizedTitle = raceTitle.replace(/[''`]/g, "").replace(/\s+/g, " ");
    if (normalizedTitle === normalizedClean) {
      return race;
    }

    let score = 0;
    for (const word of nameWords) {
      const normalizedWord = word.replace(/[''`]/g, "");
      if (raceTitle.includes(word) || raceSlug.includes(word) || normalizedTitle.includes(normalizedWord)) {
        score++;
      }
    }

    const matchRatio = nameWords.length > 0 ? score / nameWords.length : 0;
    if (matchRatio >= 0.7 && (score > bestScore || (score === bestScore && bestMatch && raceTitle.length < bestMatch.title.length))) {
      bestScore = score;
      bestMatch = race;
    }
  }

  return bestMatch;
}

async function uploadResultsToRace(
  article: any,
  sessionCookie: string,
  rcRaces: Array<{ id: number; slug: string; title: string; resultsToken: string; category: string; isStageRace: boolean; startDate: string; endDate: string | null }>,
  logger: any,
  uploadedRcRaceIds?: Set<number>,
  gcUploadedStages?: Map<number, number>,
): Promise<void> {
  const matchedRace = findMatchingRace(article.raceName, rcRaces);
  if (!matchedRace) {
    logger?.info(`🏁 [uploadResults] No matching race found on portal for "${article.raceName}" — skipping results upload`);
    return;
  }

  logger?.info(`🏁 [uploadResults] Matched "${article.raceName}" → RC race [${matchedRace.id}] "${matchedRace.title}" (slug: ${matchedRace.slug})`);

  // For one-day races: skip if a higher-priority race already uploaded results to this RC race in this run.
  // Stage races and GC finals upload different data (per-stage / overall) so they are never skipped.
  const isOneDayRace = !article.stageNumber && !article.isFinalGC;
  if (isOneDayRace && uploadedRcRaceIds?.has(matchedRace.id)) {
    logger?.info(`⏭️ [uploadResults] Skipping results for "${article.raceName}" — RC race [${matchedRace.id}] already received results from a higher-priority race this run`);
    return;
  }

  const rankings = article.rankings.map((r: any) => ({
    position: r.position,
    name: r.name,
    team: r.team || "",
    time: r.time || "",
  }));

  if (article.isFinalGC) {
    if (!matchedRace.resultsToken) {
      logger?.warn(`⚠️ [uploadResults] No results token for race "${matchedRace.title}" — cannot upload GC classification`);
      return;
    }
    logger?.info(`🏁 [uploadResults] GC final: uploading overall classification to "${matchedRace.title}" via token`);
    try {
      await axios.post(
        `https://radiociclismo.com/api/races/${matchedRace.id}/results`,
        {
          rankings,
          summary: `Classifica Generale Finale ${matchedRace.title}`,
          summaryEn: `Final General Classification ${matchedRace.title}`,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-results-token": matchedRace.resultsToken,
          },
          timeout: 10000,
        },
      );
      logger?.info(`✅ [uploadResults] Uploaded GC classification (${rankings.length} riders) to "${matchedRace.title}"`);
    } catch (gcErr: any) {
      logger?.warn(`⚠️ [uploadResults] Could not upload GC results: ${gcErr?.response?.data ? JSON.stringify(gcErr.response.data) : gcErr.message}`);
    }
  } else if (article.isStageRace && article.stageNumber) {
    logger?.info(`🏁 [uploadResults] Stage race${article.isTTT ? ' (TTT)' : ''}: creating/updating stage ${article.stageNumber} for "${matchedRace.title}"`);

    let existingStages: any[] = [];
    try {
      const stagesRes = await axios.get(`https://radiociclismo.com/api/races/${matchedRace.id}/stages`, {
        headers: { Cookie: sessionCookie },
        timeout: 10000,
      });
      existingStages = stagesRes.data || [];
    } catch (e) {
      logger?.warn(`⚠️ [uploadResults] Could not fetch stages for race ${matchedRace.id}`);
    }

    let stageId: number | null = null;
    const existingStage = existingStages.find((s: any) => s.stageNumber === article.stageNumber);
    if (existingStage) {
      stageId = existingStage.id;
      logger?.info(`🏁 [uploadResults] Stage ${article.stageNumber} already exists (id: ${stageId}), updating results`);
    } else {
      try {
        const stageTitle = article.isTTT ? `Tappa ${article.stageNumber} (Cronosquadre)` : `Tappa ${article.stageNumber}`;
        const createRes = await axios.post(
          `https://radiociclismo.com/api/admin/races/${matchedRace.id}/stages`,
          {
            stageNumber: article.stageNumber,
            title: stageTitle,
            stageType: article.isTTT ? "ttt" : "road",
            startLocation: article.startLocation || "N/D",
            endLocation: article.endLocation || "N/D",
            date: article.raceDate || new Date().toISOString().split("T")[0],
          },
          {
            headers: { "Content-Type": "application/json", Cookie: sessionCookie },
            timeout: 10000,
          },
        );
        stageId = createRes.data?.id;
        logger?.info(`✅ [uploadResults] Created stage ${article.stageNumber} (id: ${stageId}) for "${matchedRace.title}"`);
      } catch (createErr: any) {
        logger?.warn(`⚠️ [uploadResults] Could not create stage ${article.stageNumber}: ${createErr?.response?.data ? JSON.stringify(createErr.response.data) : createErr.message}`);
        return;
      }
    }

    if (stageId) {
      try {
        const winnerEntry = rankings.find((r: any) => r.position === 1);
        const winnerName = article.isTTT
          ? (winnerEntry?.name || article.winnerName || "")
          : (winnerEntry?.name || article.winnerName || "");
        const winnerTeam = article.isTTT
          ? (winnerEntry?.name || "")
          : (winnerEntry?.team || "");
        await axios.put(
          `https://radiociclismo.com/api/admin/races/${matchedRace.id}/stages/${stageId}`,
          {
            rankings,
            winnerName,
            winnerTeam,
            winnerTime: winnerEntry?.time || "",
          },
          {
            headers: { "Content-Type": "application/json", Cookie: sessionCookie },
            timeout: 10000,
          },
        );
        logger?.info(`✅ [uploadResults] Uploaded ${rankings.length} results to stage ${article.stageNumber} of "${matchedRace.title}"${article.isTTT ? ' (TTT - team classification)' : ''}`);
      } catch (putErr: any) {
        logger?.warn(`⚠️ [uploadResults] Could not update stage results: ${putErr?.response?.data ? JSON.stringify(putErr.response.data) : putErr.message}`);
      }

      // Upload current GC standings — skip if a newer stage already uploaded GC for this race in this run
      const gcRankings = article.gcRankings || [];
      const stageNum = article.stageNumber ?? 0;
      const lastGcStage = gcUploadedStages?.get(matchedRace.id);
      const gcAlreadyNewer = lastGcStage !== undefined && lastGcStage > stageNum;
      if (gcRankings.length > 0 && matchedRace.resultsToken && !gcAlreadyNewer) {
        logger?.info(`📊 [uploadResults] Uploading current GC standings (${gcRankings.length} riders) to "${matchedRace.title}" after stage ${stageNum}`);
        try {
          await axios.post(
            `https://radiociclismo.com/api/races/${matchedRace.id}/results`,
            {
              rankings: gcRankings.map((r: any) => ({
                position: r.position,
                name: r.name,
                team: r.team || "",
                time: r.time || "",
              })),
              summary: `Classifica Generale dopo la tappa ${stageNum} — ${matchedRace.title}`,
              summaryEn: `General Classification after stage ${stageNum} — ${matchedRace.title}`,
            },
            {
              headers: {
                "Content-Type": "application/json",
                "x-results-token": matchedRace.resultsToken,
              },
              timeout: 10000,
            },
          );
          gcUploadedStages?.set(matchedRace.id, stageNum);
          logger?.info(`✅ [uploadResults] GC standings updated after stage ${stageNum} for "${matchedRace.title}"`);
        } catch (gcErr: any) {
          logger?.warn(`⚠️ [uploadResults] Could not upload GC standings: ${gcErr?.response?.data ? JSON.stringify(gcErr.response.data) : gcErr.message}`);
        }
      } else if (gcRankings.length > 0 && matchedRace.resultsToken && gcAlreadyNewer) {
        logger?.info(`⏭️ [uploadResults] Skipping GC for stage ${stageNum} of "${matchedRace.title}" — stage ${lastGcStage} already set newer GC this run`);
      } else if (gcRankings.length > 0 && !matchedRace.resultsToken) {
        logger?.warn(`⚠️ [uploadResults] No resultsToken for "${matchedRace.title}" — skipping GC standings upload`);
      }
    }
  } else {
    if (!matchedRace.resultsToken) {
      logger?.warn(`⚠️ [uploadResults] No results token for race "${matchedRace.title}" — cannot upload one-day results`);
      return;
    }
    logger?.info(`🏁 [uploadResults] One-day race: uploading results to "${matchedRace.title}" via token`);
    try {
      await axios.post(
        `https://radiociclismo.com/api/races/${matchedRace.id}/results`,
        {
          rankings,
          summary: `Ordine d'arrivo ${matchedRace.title}`,
          summaryEn: `Race results ${matchedRace.title}`,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-results-token": matchedRace.resultsToken,
          },
          timeout: 10000,
        },
      );
      logger?.info(`✅ [uploadResults] Uploaded ${rankings.length} results to one-day race "${matchedRace.title}"`);
      uploadedRcRaceIds?.add(matchedRace.id);
    } catch (postErr: any) {
      logger?.warn(`⚠️ [uploadResults] Could not upload results: ${postErr?.response?.data ? JSON.stringify(postErr.response.data) : postErr.message}`);
    }
  }
}

function buildContentWithExtras(article: any): { contentIt: string; contentEn: string } {
  let contentIt = article.contentIt || "";
  let contentEn = article.contentEn || "";

  if (article.bulletPoints && article.bulletPoints.length > 0) {
    contentIt += `\n<h2>In breve</h2>\n<ul>${article.bulletPoints.map((bp: string) => `<li>${bp}</li>`).join("")}</ul>`;
    contentEn += `\n<h2>Key Points</h2>\n<ul>${article.bulletPoints.map((bp: string) => `<li>${bp}</li>`).join("")}</ul>`;
  }

  if (article.socialVersion) {
    contentIt += `\n<h2>Per i social</h2>\n<p>${article.socialVersion}</p>`;
    contentEn += `\n<h2>Social Media</h2>\n<p>${article.socialVersion}</p>`;
  }

  return { contentIt, contentEn };
}

export const cyclingWorkflow = createWorkflow({
  id: "cycling-article-workflow",
  inputSchema: z.object({}) as any,
  outputSchema: z.object({
    published: z.boolean(),
    articlesPublished: z.number(),
    message: z.string(),
  }),
})
  .then(searchRacesStep as any)
  .then(retryNarrativesStep as any)
  .then(generateArticlesStep as any)
  .then(publishStep as any)
  .commit();
