import { serve } from "inngest/next"; // Usa /next anche su Vercel, è più compatibile
import { mastra } from "../src/mastra/index.js";
import { inngest } from "../src/mastra/inngest.js";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    mastra.getWorkflow("cyclingWorkflow").createInngestFunction(),
  ],
});
