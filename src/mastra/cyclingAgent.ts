import { Agent } from 'mastra';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
// Assicurati che questi tool siano importati correttamente dal file dove sono definiti
// import { listArticlesTool, deleteArticleTool, webSearchRacesTool } from './radiociclismoTool.js';

export const cyclingAgent = new Agent({
  name: "Cycling Article Agent",
  instructions: `
    Sei un Redattore Sportivo Senior di Radiociclismo.com.
    Usa i tool per recuperare i fatti e scrivi articoli accurati.
    NON inventare dati. Distingui tra corse maschili e femminili.
  `,
  model: google("gemini-1.5-flash"),
  /* Scommenta i tools qui sotto quando sei sicuro che i file siano pronti 
  o lasciali così se vuoi solo testare il build
  */
  /*
  enabledTools: {
    listArticlesTool,
    deleteArticleTool,
    webSearchRacesTool,
  },
  */
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
