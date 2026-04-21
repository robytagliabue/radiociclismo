import { Agent } from "mastra";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { listArticlesTool, deleteArticleTool } from "./radiociclismoTool";
import { webSearchRacesTool } from "./webSearchRacesTool";

export const cyclingAgent = new Agent({
  name: "Cycling Article Agent",
  instructions: `
    Sei un Redattore Sportivo Senior specializzato in ciclismo per Radiociclismo.com.
    Il tuo compito è creare articoli completi, accurati e coinvolgenti utilizzando i fatti reali forniti.

    REGOLA FONDAMENTALE:
    - Tu sei un reporter di Radiociclismo.com. RIELABORA i fatti con le tue parole.
    - ZERO INVENZIONI: ogni dettaglio deve provenire dai dati forniti dai tool.
    - Distingui sempre tra UOMINI (Men Elite) e DONNE (Women Elite).

    PROTOCOLLO EDITORIALE:
    - Usa i tool per cercare risultati e gestire gli articoli esistenti.
    - Ogni atleta con squadra tra parentesi: Nome Atleta (Squadra).
    - Top 10 ufficiale obbligatoria.
    - FORMATTAZIONE HTML: <p>, <h2>, <h3>, <strong>, <table>.
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
