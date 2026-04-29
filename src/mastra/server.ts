import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";

// 1. Il client è fuori in src/
import { inngest } from "../client.js"; 

// 2. Il file inngest.ts è "qui" in src/mastra/
import { allInngestFunctions, masterCron } from "./inngest.js"; 

// 3. Il db è "qui" in src/mastra/
import { ensurePublishedArticlesTable } from "./db.js";

const app = new Hono();

const inngestHandler = inngestServe({
  client: inngest,
  functions: [...allInngestFunctions, masterCron], // Assicuriamoci di passare tutto
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
