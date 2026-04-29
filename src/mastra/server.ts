import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";

// 1. Il client è fuori in src/ (risalendo da src/mastra/)
import { inngest } from "../client.js"; 

// 2. Il file inngest.ts è nella stessa cartella (src/mastra/)
import { allInngestFunctions } from "./inngest.js"; 

// 3. Il db è nella stessa cartella (src/mastra/)
import { ensurePublishedArticlesTable } from "./db.js";

const app = new Hono();

// NOTA: Non serve aggiungere masterCron separatamente perché 
// lo abbiamo già inserito nell'array allInngestFunctions dentro inngest.ts
const inngestHandler = inngestServe({
  client: inngest,
  functions: allInngestFunctions, 
});

// Endpoint API
app.on(["GET", "POST", "PUT"], "/api/inngest", (c) => inngestHandler(c));

// Rotta di Debug
app.get("/debug", (c) => {
  return c.json({
    status: "running",
    env: {
      INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ? "✅" : "❌",
      DATABASE_URL: process.env.DATABASE_URL ? "✅" : "❌",
    },
    registeredFunctions: allInngestFunctions.length
  });
});

app.get("/", (c) => c.json({ status: "online", service: "RadioCiclismo Engine" }));

const port = Number(process.env.PORT) || 8080;

// Avvio del database e poi del server
ensurePublishedArticlesTable()
  .then(() => {
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
    console.log(`🚀 Server RadioCiclismo attivo su porta ${port}`);
  })
  .catch((err) => {
    console.error("⚠️ Errore critico DB:", err.message);
    // Avviamo comunque il server per permettere il debug/inngest
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  });
