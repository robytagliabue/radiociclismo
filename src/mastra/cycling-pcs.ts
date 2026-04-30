import { inngest } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";
import FormData from "form-data";

const RC_BASE = "https://radiociclismo.com";
const PCS_BASE = "https://www.procyclingstats.com";

// --- LOGICA EDITORIALE STORICA ---
const STILI_EDITORIALI = [
  { id: "EPICO_NARRATORE", prompt: "Stile L'EPICO NARRATORE — Focus: resilienza e percorso dell'atleta. Se mancano dati storici, passa a CRONISTA FLASH." },
  { id: "SPECIALISTA_TECNICO", prompt: "Stile LO SPECIALISTA TECNICO — Focus: tattica, scatti e gestione del ritmo. Zero aggettivi vuoti." },
  { id: "FLASH_NEWS", prompt: "Stile IL CRONISTA FLASH — Focus: immediatezza, Top 10 e fatti nudi." },
  { id: "TECH_GURU", prompt: "Stile IL TECH-GURU — Focus: materiali e performance. Se mancano dati tecnici, passa a SPECIALISTA TECNICO." }
];

// Helper per normalizzazione e matching
const slugify = (t: string) => t.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');
const normalizza = (n: string) => n.toLowerCase().replace(/\d{4}/g, "").replace(/[^a-z\s]/g, "").trim();

async function getSessionCookie(): Promise<string> {
  try {
    const res = await axios.post(`${RC_BASE}/api/admin/login`, 
      { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD },
      { headers: { "Content-Type": "application/json" } }
    );
    return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
  } catch { return ""; }
}

function generaCSV(risultati: any[]): Buffer {
  const header = "POSIZIONE,NOME,SQUADRA,TEMPO,DISTACCO,NAZIONE\n";
  const rows = risultati.map(r => `${r.pos},"${r.nome}","${r.team}","${r.time || ""}","${r.diff || ""}","IT"`).join("\n");
  return Buffer.from(header + rows, "utf-8");
}

export const cyclingProcessRaceFn = inngest.createFunction(
  { id: "cycling-worker", name: "RadioCiclismo — PCS Full Worker", concurrency: 1 },
  { event: "cycling/process.single.race" },
  async ({ event, step }) => {
    const { gara, index } = event.data; // index serve per la rotazione stili
    const raceSlug = slugify(gara.nome);
    const sessionCookie = await step.run("get-cookie", () => getSessionCookie());

    // --- STEP 1: SCRAPING RISULTATI ---
    const risultati = await step.run("scrape-pcs-results", async () => {
      const cmd = `curl -s -L --http2 -H "User-Agent: Mozilla/5.0" "${PCS_BASE}${gara.url}"`;
      const html = execSync(cmd).toString();
      const $ = cheerio.load(html);
      const rows: any[] = [];
      $("table.results tbody tr").slice(0, 15).each((i, el) => {
        rows.push({
          pos: i + 1,
          nome: $(el).find("td:nth-child(2)").text().trim(),
          team: $(el).find("td:nth-child(3)").text().trim(),
          time: $(el).find("td:nth-child(4)").text().trim()
        });
      });
      return rows;
    });

    if (!risultati || risultati.length === 0) return { status: "no_results" };

    // --- STEP 2: UPLOAD DATI TECNICI (CSV) ---
    await step.run("upload-csv-results", async () => {
      const rcGareRes = await axios.get(`${RC_BASE}/api/admin/races?status=approved`, { headers: { Cookie: sessionCookie } });
      const targetGara = rcGareRes.data.find((g: any) => normalizza(g.title).includes(normalizza(gara.nome).substring(0, 10)));
      
      if (targetGara) {
        const csv = generaCSV(risultati);
        const form = new FormData();
        form.append("file", csv, { filename: `results-${raceSlug}.csv`, contentType: "text/csv" });
        await axios.post(`${RC_BASE}/api/admin/races/${targetGara.id}/import-results`, form, {
          headers: { ...form.getHeaders(), Cookie: sessionCookie }
        });
        return { status: "csv_uploaded", garaId: targetGara.id };
      }
      return { status: "no_matching_race_in_db" };
    });

    // --- STEP 3: GENERAZIONE ARTICOLO CON STILE ROTATIVO ---
    const articoloAI = await step.run("gen-article-style", async () => {
      const stile = STILI_EDITORIALI[index % STILI_EDITORIALI.length];
      const res = await (cyclingAgent as any).generateLegacy(
        `Applica lo ${stile.prompt}. Gara: ${gara.nome}. Risultati: ${JSON.stringify(risultati.slice(0, 10))}.
        Se non hai dati, scrivi "SKIP". Ritorna JSON: { "titolo": "", "contenuto": "", "excerpt": "", "tags": [] }`
      );
      return res?.object || res;
    });

    // --- STEP 4: PUBBLICAZIONE SCHEDULATA ---
    await step.run("publish-article", async () => {
      if (!articoloAI || articoloAI === "SKIP" || articoloAI.contenuto?.length < 250) return { status: "skipped" };

      const publishDate = new Date();
      publishDate.setHours(publishDate.getHours() + 2);

      await axios.post(`${RC_BASE}/api/admin/articles`, {
        slug: `report-${raceSlug}-${Date.now()}`,
        title: articoloAI.titolo,
        content: articoloAI.contenuto,
        excerpt: articoloAI.excerpt || "",
        author: "RadioCiclismo Reporter",
        publishAt: publishDate.toISOString(),
        hashtags: articoloAI.tags || ["#ciclismo"],
        is_published: false
      }, { headers: { Cookie: sessionCookie } });

      return { status: "published_scheduled" };
    });
  }
);
