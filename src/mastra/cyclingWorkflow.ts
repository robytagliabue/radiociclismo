import { inngest } from "./inngest.js";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

export const cyclingWorkflowFn = inngest.createFunction(
  { id: "cycling-workflow", name: "Cycling Workflow" },
  { event: "cycling/generate.article" },

  async ({ event, step }) => {
    const input = event.data.input;

    const analisi = await step.run("analizza-gara", async () => {
      const result = await generateObject({
        model: google("gemini-1.5-flash"),
        prompt: `Sei un esperto di ciclismo professionistico. ${input}. Fornisci la top 10 ufficiale.`,
        schema: z.object({
          top10: z.array(z.object({
            posizione: z.number(),
            nome: z.string(),
            squadra: z.string(),
            distacco: z.string(),
          })),
        }),
      });
      return result.object;
    });

    const articolo = await step.run("genera-articolo", async () => {
      const top10Text = analisi.top10
        .map((r) => `${r.posizione}. ${r.nome} (${r.squadra}) - ${r.distacco}`)
        .join("\n");

      const result = await generateObject({
        model: google("gemini-1.5-flash"),
        prompt: `Sei un giornalista di RadioCiclismo. Scrivi un articolo professionale basato su questa top 10:\n${top10Text}`,
        schema: z.object({
          titolo: z.string(),
          sommario: z.string(),
          corpo: z.string(),
          tags: z.array(z.string()),
        }),
      });
      return result.object;
    });

    console.log("Articolo generato:", articolo.titolo);
    return { success: true, analisi, articolo };
  }
);
