import { serve } from "inngest/next";
import { inngest } from "../src/mastra/inngest.js";
// Importiamo la versione buildata da Mastra che Vercel ha appena creato
import { mastra } from "../.mastra/output/index.mjs"; 

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    mastra.getWorkflow("cycling-sync").createInngestFunction(),
  ],
});
