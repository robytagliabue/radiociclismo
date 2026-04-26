import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { inngest } from "./inngest.js";
import { cyclingWorkflowFn } from "./cyclingWorkflow.js";
import { ensurePublishedArticlesTable, pool } from "./db.js";

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
    RC_USERNAME: process.env.RC_USERNAME ? "presente" : "mancante",
    RC_PASSWORD: process.env.RC_PASSWORD ? "presente" : "mancante",
    PORT: process.env.PORT ?? "mancante",
  });
});

app.post("/trigger/articolo", async (c) => {
  const body = await c.req.json();
  if (!body.pcsUrl) {
    return c.json({ error: "pcsUrl obbligatorio" }, 400);
  }
  await inngest.send({
    name: "cycling/generate.article",
    data: {
      pcsUrl: body.pcsUrl,
      nomeGara: body.nomeGara ?? "",
      tipoGara: body.tipoGara ?? "singola",
      categoria: body.categoria ?? "men",
    },
  });
  return c.json({ success: true, message: "Workflow avviato!" });
});

app.get("/gara/csv/:externalId", async (c) => {
  const id = decodeURIComponent(c.req.param("externalId"));
  const res = await pool.query(
    `SELECT rr.position, rr.cyclist_name, rr.team_name, rr.time_gap
     FROM race_results rr
     JOIN races r ON r.id = rr.race_id
     WHERE r.external_id = $1
     ORDER BY rr.position`,
    [id]
  );
  const csv =
    "Posizione,Nome,Squadra,Distacco\n" +
    res.rows
      .map(
        (r: any) =>
          `${r.position},"${r.cyclist_name}","${r.team_name}","${r.time_gap}"`
      )
      .join("\n");
  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="risultati.csv"`);
  return c.body(csv);
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
console.log("RadioCiclismo online sulla porta " + port);

ensurePublishedArticlesTable()
  .then(() => console.log("Tabelle database pronte"))
  .catch((err) => console.error("Warning database:", err.message));
