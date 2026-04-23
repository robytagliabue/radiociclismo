import { serve } from "inngest/vercel";
import { mastra } from "../src/mastra/index.js";
import { inngest } from "../src/mastra/inngest.js";

// Questo espone il workflow a Inngest Cloud
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // Aggancia il workflow che abbiamo creato
    mastra.getWorkflow("cyclingWorkflow").createInngestFunction(),
  ],
});
