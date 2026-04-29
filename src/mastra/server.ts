import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";

// --- CORREZIONE PERCORSI ---
// Usiamo "../" perché i file sono nella cartella superiore (src)
import { inngest } from "../client.js"; 
import { allInngestFunctions } from "../inngest.js"; 
import { ensurePublishedArticlesTable, pool } from "../db.js";
// ---------------------------

const app = new Hono();

// Configurazione Inngest
const inngestHandler = inngestServe({
  client: inngest,
  functions: allInngestFunctions,
});

// Endpoint API
app.on(["GET", "POST", "PUT"], "/api/inngest", (c) => inngestHandler(c));

// Rotta di Debug (Verifica che le variabili siano lette correttamente)
app.get("/debug", (c) => {
  return c.json({
    env: {
      INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ? "✅" : "❌",
      DATABASE_URL: process.env.DATABASE_URL ? "✅" : "❌",
    },
    paths: "Cercando i file in src/ (risalendo da src/mastra/)"
  });
});

app.get("/", (c) => c.json({ status: "online", service: "RadioCiclismo Engine" }));

const port = Number(process.env.PORT) || 8080;

ensurePublishedArticlesTable()
  .then(() => {
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
    console.log(`🚀 Server RadioCiclismo attivo su porta ${port}`);
  })
  .catch((err) => {
    console.error("Database error:", err.message);
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  });
