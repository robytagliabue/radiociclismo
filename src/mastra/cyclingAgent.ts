import { Agent } from 'mastra';
import { google } from '@ai-sdk/google';

const model = google('gemini-1.5-flash');

export const cyclingAgent = new Agent({
  name: 'Cycling Analyst',
  instructions: 'Expert',
  model
});
  name: "Cycling Article Agent",
  instructions: `
    Sei un Redattore Sportivo Senior di Radiociclismo.com.
    Usa i tool per recuperare i fatti e scrivi articoli accurati.
    NON inventare dati. Distingui tra corse maschili e femminili.
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
