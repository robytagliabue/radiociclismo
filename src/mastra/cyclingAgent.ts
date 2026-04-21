import { Agent } from "mastra";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { listArticlesTool, deleteArticleTool } from "./radiociclismoTool.js";
import { webSearchRacesTool } from "./webSearchRacesTool.js";

export const cyclingAgent = new Agent({
  name: "Cycling Article Agent",
  instructions: `
    Sei un Redattore Sportivo Senior specializzato in ciclismo per Radiociclismo.com.
    Il tuo compito è creare articoli completi, accurati e coinvolgenti utilizzando i fatti reali forniti dai tool.

    REGOLA FONDAMENTALE:
    - Tu sei un reporter di Radiociclismo.com. RIELABORA i fatti con le tue parole.
    - ZERO INVENZIONI: ogni dettaglio deve provenire dai dati forniti.
  `,
  model: google("gemini-1.5-flash"),
  tools: {
    listArticlesTool,
    deleteArticleTool,
    webSearchRacesTool,
  },
  outputs: {
    schema: z.object({
      top10: z.array(
        z.object({
          posizione: z.number(),
          nome: z.string(),
          squadra: z.string(),
          distacco: z.string(),
        })
      ),
    }),
  },
});
