import { inngest, FCI_EVENT } from "../client.js";
import { cyclingAgent } from "./cyclingAgent.js"; 
import axios from "axios";
import { execSync } from "child_process";
import * as cheerio from "cheerio";

const RC_BASE = "https://radiociclismo.com";

function fetchPage(url: string): string {
  try {
    const cmd = `curl -s -L --http2 --max-time 30 -H "User-Agent: Mozilla/5.0" --compressed "${url}"`;
    return execSync(cmd, { maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (e: any) { return ""; }
}

export const fciWorkflowFn = inngest.createFunction(
  { id: "fci-workflow", name: "RadioCiclismo — Nazionali & News", concurrency: 2 },
  { event: FCI_EVENT },
  async ({ step }) => {
    // Simuliamo lo scraping per brevità
    const newsArticoli = [{ titolo: "Giro d'Abruzzo", url: "https://bici.pro/news/giovani/" }];

    for (const art of newsArticoli) {
      await step.run(`process-news-${art.titolo.substring(0,5)}`, async () => {
        const res = await cyclingAgent.generateLegacy([
          {
            role: "user",
            content: `Rielabora news: ${art.titolo}. Ritorna JSON: titolo, contenuto, excerpt, slug, tags.`
          }
        ] as any);

        const articolo = (res as any).object || res;
        console.log("FCI Generato:", articolo.titolo);
      });
    }
    return { processed: newsArticoli.length };
  }
);
