/**
 * server.ts  →  src/mastra/server.ts
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { inngest } from "../client.js";
import { allInngestFunctions } from "./inngest.js";

const app = new Hono();

const inngestHandler = inngestServe({
  client: inngest,
  functions: allInngestFunctions,
});

app.on(["GET", "POST", "PUT"], "/api/inngest", (c) => inngestHandler(c));

app.get("/debug", (c) => {
  return c.json({
    status: "running",
    env: {
      INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ? "✅" : "❌",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "✅" : "❌",
      DATABASE_URL: process.env.DATABASE_URL ? "✅" : "❌",
      RC_USERNAME: process.env.RC_USERNAME ? "✅" : "❌",
    },
    registeredFunctions: allInngestFunctions.length,
  });
});

app.get("/", (c) => c.json({ status: "online", service: "RadioCiclismo Engine" }));

const port = Number(process.env.PORT) || 8080;

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`🚀 Server RadioCiclismo attivo su porta ${port}`);
