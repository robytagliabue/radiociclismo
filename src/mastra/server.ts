import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { inngest } from "./inngest.js";
import { cyclingWorkflowFn } from "./cyclingWorkflow.js";
import { ensurePublishedArticlesTable } from "./db.js";

const app = new Hono();

const inngestHandler = inngestServe({
  client: inngest,
  functions: [cyclingWorkflowFn],
});

app.on(["GET", "POST", "PUT"], "/api/inngest", (c) => inngestHandler(c));

app.get("/debug", (c) => {
  return c.json({
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ? "presente" : "mancante",
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY ? "presente" : "mancante",
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "presente" : "mancante",
    DATABASE_URL: process.env.DATABASE_URL ? "presente" : "mancante",
    PORT: process.env.PORT ?? "mancante",
  });
});

app.post("/trigger/articolo", async (c) => {
  const body = await c.req.json();
  await inngest.send({
    name: "cycling/generate.article",
    data: { input: body.input ?? "Analizza la tappa di oggi" },
  });
  return c.json({ success: true, message: "Articolo in generazione..." });
});

app.get("/", (c) => {
  return c.json({ status: "online", service: "RadioCiclismo AI Journalist", version: "v6" });
});

const port = Number(process.env.PORT) || 8080;

// Crea le tabelle al primo avvio
ensurePublishedArticlesTable()
  .then(() => {
    console.log("Tabelle database pronte");
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
    console.log("RadioCiclismo online sulla porta " + port);
  })
  .catch((err) => {
    console.error("Errore database:", err);
    process.exit(1);
  });
