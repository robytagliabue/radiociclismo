import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Inngest } from "inngest";
import { serve as inngestServe } from "inngest/hono";

const app = new Hono();

const inngest = new Inngest({
  id: "radiociclismo-v6-core",
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

const pingFn = inngest.createFunction(
  { id: "ping-v6", name: "Ping V6" },
  { event: "app/ping" },
  async ({ event, step }) => {
    return { message: "Pong! RadioCiclismo operativo" };
  }
);

const inngestHandler = inngestServe({
  client: inngest,
  functions: [pingFn],
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
  return c.json({
    status: "online",
    service: "RadioCiclismo AI Journalist",
    version: "v6",
  });
});

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });