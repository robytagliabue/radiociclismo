import { inngest } from "./inngest.js";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import axios from "axios";
import pg from "pg";

const { Pool } = pg;
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const RC_BASE = "https://radiociclismo.com";

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

    return {
      success: true,
      gareProcessate: gareOggi.length,
      report,
    };
  }
);
