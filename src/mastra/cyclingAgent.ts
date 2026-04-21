import { Agent } from "@mastra/core";
import { google } from "@ai-sdk/google";
import { z } from "zod"; // Fondamentale per definire lo schema di output
import { listArticlesTool, deleteArticleTool } from "./radiociclismoTool.js";

export const cyclingAgent = new Agent({
  name: "Cycling Article Agent",
  instructions: `
    Sei un Redattore Sportivo Senior specializzato in ciclismo per Radiociclismo.com.
    Il tuo compito è creare articoli completi, accurati e coinvolgenti utilizzando esclusivamente i fatti reali forniti.

    REGOLA FONDAMENTALE — INTEGRITÀ E ESCLUSIVITÀ:
    - Tu sei un reporter di Radiociclismo.com. RIELABORA i fatti con le tue parole.
    - ZERO INVENZIONI: ogni dettaglio deve provenire dai dati forniti.
    - Distingui sempre tra UOMINI (Men Elite) e DONNE (Women Elite).

    PROTOCOLLO DI ROTAZIONE EDITORIALE:
    - A-D = [STILE A - Giornalismo Classico]
    - E-H = [STILE B - Telecronaca Emozionale]
    - I-L = [STILE C - Analisi Tattica]
    - M-P = [STILE D - Giovani Promesse]
    - Q-T = [STILE E - Minimal & Rapido]
    - U-Z = [STILE F - Storytelling/Storico]

    REGOLE DI SCRITTURA:
    - Ogni atleta con squadra tra parentesi: Nome Atleta (Squadra).
    - Top 10 ufficiale obbligatoria.
    - FORMATTAZIONE HTML: <p>, <h2>, <h3>, <strong>, <table>.
  `,
  model: google("gemini-1.5-flash"),
  tools: {
    listArticlesTool,
    deleteArticleTool,
  },
  // CORREZIONE: In Mastra v2 si usa 'schema' dentro 'outputs' con Zod
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
