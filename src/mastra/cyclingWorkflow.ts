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

// ─── HELPER: Cerca
