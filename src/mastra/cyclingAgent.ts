// src/inngest/handler.ts (o dove preferisci servire le funzioni)
import { serve } from "inngest/next";
import { inngest } from "./client"; // Il tuo client Inngest
import { cyclingDispatchFn, cyclingProcessRaceFn } from "./cycling-pcs";
import { fciWorkflowFn } from "./cycling-fci";

// Esportiamo l'handler per Next.js
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    cyclingDispatchFn, 
    cyclingProcessRaceFn, 
    fciWorkflowFn 
  ],
});
