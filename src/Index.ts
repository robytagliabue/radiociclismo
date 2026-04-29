import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { inngest } from "./client.js"; // IMPORTANTE: Usa il client centralizzato
import { serve as inngestServe } from "inngest/hono";

// Importa tutte le funzioni dai nuovi file
import { cyclingDispatchFn, cyclingProcessRaceFn } from "./cycling-pcs.js";
import { fciWorkflowFn } from "./fci-workflow.js";
import { masterCron } from "./inngest-main.js"; // Non dimenticare il Direttore d'Orchestra!

const app = new Hono();

// Handler Inngest per Hono
const inngestHandler = inngestServe({
  client: inngest,
  functions: [
    cyclingDispatchFn,
    cyclingProcessRaceFn,
    fciWorkflowFn,
    masterCron, // Registra il Cron qui!
  ],
});

// Endpoint per Inngest
app.on(["GET", "POST", "PUT"], "/api/inngest", (c) => inngestHandler(c));

// Debug e Health Check
app.get("/debug", (c) => {
  return c.json({
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ? "presente" : "mancante",
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY ? "presente" : "mancante",
    PORT: process.env.PORT ?? "8080 (default)",
  });
});

app.get("/", (c) => {
  return c.json({
    status: "online",
    service: "RadioCiclismo AI Journalist",
    version: "v6",
    active_functions: [
      "pcs-international",
      "fci-national",
      "master-scheduler"
    ],
  });
});

const port = Number(process.env.PORT) || 8080;
console.log(`🚀 RadioCiclismo v6 in ascolto sulla porta ${port}`);

serve({ 
  fetch: app.fetch, 
  port, 
  hostname: "0.0.0.0" 
});
