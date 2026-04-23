import { Agent } from 'mastra';
import { google } from '@ai-sdk/google';

/**
 * Definiamo le costanti separatamente per evitare errori di parsing 
 * della CLI di Mastra su Vercel (errore "Expected ; but found :")
 */
const agentName = 'Cycling Analyst';
const agentInstructions = 'Sei un esperto di ciclismo professionistico. Analizza i dati delle corse e scrivi articoli tecnici ma coinvolgenti.';
const agentModel = google('gemini-1.5-flash');

export const cyclingAgent = new Agent({
  name: agentName,
  instructions: agentInstructions,
  model: agentModel,
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
