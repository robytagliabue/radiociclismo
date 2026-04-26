import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { inngest } from "./inngest.js";

const app = new Hono();

// Importa le tue funzioni Inngest esistenti
// le aggiungeremo dopo aver visto cyclingAgent.ts
const functions: any[] = [];

const inngestHandler = inngestServe({
  client: inngest,
  functions,
});

app.on(["GET", "POST", "PUT"], "/api/inngest", (c) => inngestHandler(c));

app.get("/debug", (c) => {
  return c.json({
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ? "presente" : "mancante",
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY ? "presente" : "mancante",
    PORT: process.env.PORT ?? "mancante",
  });
});

app.get("/", (c) => {
  return c.json({ status: "online", service: "RadioCiclismo AI Journalist" });
});

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log("RadioCiclismo online sulla porta " + port);
