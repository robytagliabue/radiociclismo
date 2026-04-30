import { inngest } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";
import FormData from "form-data";

const RC_BASE = "https://radiociclismo.com";
const PCS_BASE = "https://www.procyclingstats.com";

const STILI_EDITORIALI = [
  { id: "EPICO_NARRATORE", prompt: "Stile L'EPICO NARRATORE — Focus: resilienza e percorso dell'atleta. Se mancano dati storici, passa a CRONISTA FLASH." },
  { id: "SPECIALISTA_TECNICO", prompt: "Stile LO SPECIALISTA TECNICO — Focus: tattica, scatti e gestione del ritmo. Zero aggettivi vuoti." },
  { id: "FLASH_NEWS", prompt: "Stile IL CRONISTA FLASH — Focus: immediatezza, Top 10 e fatti nudi." },
  { id: "TECH_GURU", prompt: "Stile IL TECH-GURU — Focus: materiali e performance. Se mancano dati tecnici, passa a SPECIALISTA TECNICO." }
];

const slugify = (t: string) => t.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');
const normalizza = (n: string) => n.toLowerCase().replace(/\d{4}/g, "").replace(/[^a-z\s]/g, "").trim();

export const cyclingDispatchFn = inngest.createFunction(
  { id: "cycling-dispatch", name: "RadioCiclismo — Dispatch PCS" },
  { event: "cycling/generate.article" },
  async ({ step }) => {
    const gareOggi = await step.run("fetch-today-races", async () => {
      const oggi = new Date().toISOString().split("T")[0];
      const html = execSync(`curl -s -L --http2 "${PCS_BASE}/races.php?date=${oggi}"`).toString();
      const $ = cheerio.load(html);
      const list: any[] = [];
      $("table tr").each((_, el) => {
        const link = $(el).find("a[href^='race/']").first();
        if (link.length) {
          list.push({ nome: link.text().trim(), url: link.attr("href") });
        }
      });
      return list;
    });

    const events = gareOggi.map((gara, index) => ({
      name: "cycling/process.single.race",
      data: { gara, index }
    }));

    if (events.length > 0) {
      await step.sendEvent("dispatch-workers", events);
    }
    return { gareTrovate: events.length };
  }
);

export const cyclingProcessRaceFn = inngest.createFunction(
  { id: "cycling-worker", name: "RadioCiclismo — PCS Full Worker", concurrency: 1 },
  { event: "cycling/process.single.race" },
  async ({ event, step }) => {
    const { gara, index } = event.data;
    const raceSlug = slugify(gara.nome);
    
    const sessionCookie = await step.run("get-cookie", async () => {
        const res = await axios.post(`${RC_BASE}/api/admin/login`, 
            { username: process.env.RC_USERNAME, password: process.env.RC_PASSWORD }
        );
        return (res.headers["set-cookie"] || []).find(c => c.includes("connect.sid"))?.split(";")[0] ?? "";
    });

    const risultati = await step.run("scrape-pcs-results", async () => {
      const html = execSync(`curl -s -L --http2 "${PCS_BASE}${gara.url}"`).toString();
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

    // 1. Upload CSV Risultati Tecnici
    await step.run("upload-csv-results", async () => {
      try {
        const rcGareRes = await axios.get(`${RC_BASE}/api/admin/races?status=approved`, { headers: { Cookie: sessionCookie } });
        const targetGara = rcGareRes.data.find((g: any) => normalizza(g.title).includes(normalizza(gara.nome).substring(0, 10)));
        if (targetGara) {
          const header = "POSIZIONE,NOME,SQUADRA,TEMPO,DISTACCO,NAZIONE\n";
          const rows = risultati.map(r => `${r.pos},"${r.nome.replace(/"/g, '')}","${r.team.replace(/"/g, '')}","${r.time || ""}","","IT"`).join("\n");
          const form = new FormData();
          form.append("file", Buffer.from(header + rows), { filename: `results.csv`, contentType: "text/csv" });
          await axios.post(`${RC_BASE}/api/admin/races/${targetGara.id}/import-results`, form, {
            headers: { ...form.getHeaders(), Cookie: sessionCookie }
          });
        }
      } catch (e: any) {
        console.error("Errore upload CSV:", e.response?.data || e.message);
      }
    });

    // 2. Generazione Articolo AI
    const articoloAI = await step.run("gen-article", async () => {
      const stile = STILI_EDITORIALI[index % STILI_EDITORIALI.length];
      const prompt = `Sei un giornalista esperto. Applica lo ${stile.prompt}. Gara: ${gara.nome}. Risultati: ${JSON.stringify(risultati.slice(0, 8))}. Ritorna JSON {titolo, contenuto, excerpt, tags}. Usa HTML <p> e <strong>.`;
      const res = await (cyclingAgent as any).generateLegacy(prompt);
      return res?.object || res;
    });

    // 3. Pubblicazione Articolo (Fix 400)
    await step.run("publish-article", async () => {
      if (!articoloAI || articoloAI === "SKIP" || !articoloAI.contenuto) return { status: "skipped" };

      const date = new Date();
      date.setHours(date.getHours() + 2);

      const payload = {
        title: articoloAI.titolo,
        content: articoloAI.contenuto,
        excerpt: articoloAI.excerpt || "",
        slug: `report-${raceSlug}-${Date.now()}`,
        author: "Radiociclismo Reporter",
        publishAt: date.toISOString(),
        hashtags: Array.isArray(articoloAI.tags) ? articoloAI.tags : ["#ciclismo"],
        is_published: false
      };

      try {
        await axios.post(`${RC_BASE}/api/admin/articles`, payload, { 
          headers: { Cookie: sessionCookie, "Content-Type": "application/json" } 
        });
        return { status: "success" };
      } catch (err: any) {
        console.error("ERRORE 400 DETTAGLIATO:", err.response?.data);
        throw new Error(`Server 400: ${JSON.stringify(err.response?.data)}`);
      }
    });
    
    return { status: "completed" };
  }
);
