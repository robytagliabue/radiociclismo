import { inngest } from "./inngest.js";
import { google } from "@ai-sdk/google";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import axios from "axios";
import { savePendingArticles, saveRaceResults, ensurePublishedArticlesTable } from "./db.js";

// ─── 5 STILI EDITORIALI ───────────────────────────────────────────────────────
const STILI_EDITORIALI = [
  {
    id: "narrativo",
    prompt: "Scrivi in stile narrativo e coinvolgente, come se raccontassi una storia epica. Usa metafore sportive e descrizioni vivide delle emozioni in gara."
  },
  {
    id: "tecnico",
    prompt: "Scrivi in stile tecnico-analitico. Analizza tattiche, dati, watt, dislivelli, strategie di squadra. Tono professionale da esperto."
  },
  {
    id: "drammatico",
    prompt: "Scrivi in stile drammatico e appassionato, enfatizzando i momenti chiave, le cadute, i sorpassi, le sofferenze dei corridori."
  },
  {
    id: "cronachistico",
    prompt: "Scrivi in stile cronaca sportiva classica, preciso e diretto. Chi, cosa, dove, quando. Tono giornalistico tradizionale."
  },
  {
    id: "statistico",
    prompt: "Scrivi valorizzando statistiche, record, confronti storici, percentuali. Cita dati concreti e comparazioni con edizioni precedenti."
  },
];

// ─── HELPER: Sessione RadioCiclismo ──────────────────────────────────────────
async function getSessionCookie(): Promise<string> {
  try {
    const response = await axios.post(
      "https://radiociclismo.com/api/admin/login",
      {
        username: process.env.RC_USERNAME,
        password: process.env.RC_PASSWORD,
      },
      {
        headers: { "Content-Type": "application/json" },
        withCredentials: true,
        maxRedirects: 0,
        validateStatus: (s: number) => s < 400,
      }
    );
    const cookies = response.headers["set-cookie"] || [];
    for (const cookie of cookies) {
      if (cookie.includes("connect.sid")) return cookie.split(";")[0];
    }
    return cookies.length > 0 ? cookies[0].split(";")[0] : "";
  } catch {
    return "";
  }
}

// ─── HELPER: Scraping ProCyclingStats ────────────────────────────────────────
async function scrapePCS(url: string): Promise<string> {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Referer": "https://www.procyclingstats.com/",
      },
      timeout: 15000,
    });
    return response.data as string;
  } catch (e: any) {
    return `ERRORE_SCRAPING: ${e.message}`;
  }
}

// ─── HELPER: Cerca notizie esterne ───────────────────────────────────────────
async function cercaNotizie(nomeGara: string): Promise<string> {
  try {
    const query = encodeURIComponent(`${nomeGara} ciclismo risultati`);
    const response = await axios.get(
      `https://news.google.com/rss/search?q=${query}&hl=it&gl=IT&ceid=IT:it`,
      { timeout: 10000 }
    );
    return response.data as string;
  } catch {
    return "";
  }
}

// ─── WORKFLOW PRINCIPALE ──────────────────────────────────────────────────────
export const cyclingWorkflowFn = inngest.createFunction(
  { id: "cycling-workflow", name: "Cycling Workflow - Genera Articoli" },
  { event: "cycling/generate.article" },

  async ({ event, step }) => {
    const { pcsUrl, nomeGara, tipoGara, categoria } = event.data;
    // tipoGara: "singola" | "tappa"
    // categoria: "men" | "women"

    // ─── STEP 1: Scraping risultati ─────────────────────────────────────────
    const risultati = await step.run("scraping-risultati", async () => {
      const html = await scrapePCS(pcsUrl);
      if (html.startsWith("ERRORE_SCRAPING")) {
        throw new Error(`Impossibile recuperare dati da PCS: ${html}`);
      }

      // Estrai dati con Gemini
      const result = await generateObject({
        model: google("gemini-1.5-flash"),
        prompt: `Analizza questo HTML di ProCyclingStats e estrai i risultati della gara ciclistica.
        Tipo gara: ${tipoGara}
        HTML: ${html.substring(0, 8000)}`,
        schema: z.object({
          nomeGara: z.string(),
          data: z.string(),
          categoria: z.string(),
          classificaArrivo: z.array(z.object({
            posizione: z.number(),
            nome: z.string(),
            squadra: z.string(),
            distacco: z.string(),
          })),
          classificaGenerale: z.array(z.object({
            posizione: z.number(),
            nome: z.string(),
            squadra: z.string(),
            distacco: z.string(),
          })).optional(),
          tappa: z.string().optional(),
        }),
      });
      return result.object;
    });

    // ─── STEP 2: Cerca notizie esterne ─────────────────────────────────────
    const notizie = await step.run("cerca-notizie", async () => {
      const rss = await cercaNotizie(risultati.nomeGara);
      return rss.substring(0, 3000);
    });

    // ─── STEP 3: Seleziona stile random ────────────────────────────────────
    const stile = await step.run("seleziona-stile", async () => {
      const idx = Math.floor(Math.random() * STILI_EDITORIALI.length);
      return STILI_EDITORIALI[idx];
    });

    // ─── STEP 4: Genera articolo IT ─────────────────────────────────────────
    const articoloIT = await step.run("genera-articolo-it", async () => {
      const top10 = risultati.classificaArrivo
        .slice(0, 10)
        .map((r) => `${r.posizione}. ${r.nome} (${r.squadra}) - ${r.distacco}`)
        .join("\n");

      const classGen = risultati.classificaGenerale
        ? "\nClassifica Generale:\n" + risultati.classificaGenerale
            .slice(0, 5)
            .map((r) => `${r.posizione}. ${r.nome} (${r.squadra}) - ${r.distacco}`)
            .join("\n")
        : "";

      const result = await generateObject({
        model: google("gemini-1.5-flash"),
        prompt: `Sei un giornalista di RadioCiclismo.com. ${stile.prompt}
        
NON inventare nulla. Usa SOLO questi dati reali:
Gara: ${risultati.nomeGara}
Data: ${risultati.data}
Categoria: ${categoria === "women" ? "Donne" : "Uomini"}
${risultati.tappa ? `Tappa: ${risultati.tappa}` : ""}

Classifica arrivo:
${top10}
${classGen}

Notizie da altre fonti (usa solo fatti verificati):
${notizie.substring(0, 1000)}

Scrivi in ITALIANO. Lunghezza: 400-600 parole.`,
        schema: z.object({
          titolo: z.string(),
          sommario: z.string(),
          contenuto: z.string(),
          hashtags: z.array(z.string()),
          slug: z.string(),
        }),
      });
      return result.object;
    });

    // ─── STEP 5: Genera articolo EN ─────────────────────────────────────────
    const articoloEN = await step.run("genera-articolo-en", async () => {
      const result = await generateObject({
        model: google("gemini-1.5-flash"),
        prompt: `You are a journalist for RadioCiclismo.com. ${stile.prompt}
        
DO NOT invent anything. Translate and adapt this Italian article to English:
Title: ${articoloIT.titolo}
Content: ${articoloIT.contenuto}

Write in ENGLISH. Keep the same editorial style.`,
        schema: z.object({
          titolo: z.string(),
          sommario: z.string(),
          contenuto: z.string(),
        }),
      });
      return result.object;
    });

    // ─── STEP 6: Pubblica su RadioCiclismo (bozza) ──────────────────────────
    const pubblicazione = await step.run("pubblica-bozza", async () => {
      const sessionCookie = await getSessionCookie();
      if (!sessionCookie) throw new Error("Login RadioCiclismo fallito");

      const response = await axios.post(
        "https://radiociclismo.com/api/admin/articles",
        {
          slug: articoloIT.slug,
          title: articoloIT.titolo,
          excerpt: articoloIT.sommario,
          content: articoloIT.contenuto,
          titleEn: articoloEN.titolo,
          excerptEn: articoloEN.sommario,
          contentEn: articoloEN.contenuto,
          author: "AI Agent",
          publishAt: new Date().toISOString(),
          images: [],
          hashtags: articoloIT.hashtags,
          published: false,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Cookie: sessionCookie,
          },
        }
      );

      return {
        articleId: String(response.data?.id || ""),
        success: true,
      };
    });

    // ─── STEP 7: Salva risultati su DB + genera CSV ─────────────────────────
    const csv = await step.run("salva-risultati-csv", async () => {
      await saveRaceResults({
        externalId: pcsUrl,
        name: risultati.nomeGara,
        results: risultati.classificaArrivo.map((r) => ({
          position: r.posizione,
          name: r.nome,
          team: r.squadra,
          gap: r.distacco,
        })),
      });

      // Genera CSV
      const header = "Posizione,Nome,Squadra,Distacco\n";
      const rows = risultati.classificaArrivo
        .map((r) => `${r.posizione},"${r.nome}","${r.squadra}","${r.distacco}"`)
        .join("\n");

      return { csv: header + rows };
    });

    return {
      success: true,
      stileUsato: stile.id,
      articoloId: pubblicazione.articleId,
      nomeGara: risultati.nomeGara,
      csv: csv.csv,
    };
  }
);
