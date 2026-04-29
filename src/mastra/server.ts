import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";

// 1. Importazioni locali (con estensione .js obbligatoria per ESM)
import { inngest } from "./client.js"; 
import { allInngestFunctions } from "./inngest.js"; 
import { ensurePublishedArticlesTable, pool } from "./db.js";

const app = new Hono();

// 2. Configurazione Inngest
const inngestHandler = inngestServe({
  client: inngest,
  functions: allInngestFunctions,
});

// 3. Rotte API
app.on(["GET", "POST", "PUT"], "/api/inngest", (c) => inngestHandler(c));

// Rotta per il debug delle variabili d'ambiente
app.get("/debug", (c) => {
  return c.json({
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ? "presente" : "mancante",
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY ? "presente" : "mancante",
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "presente" : "mancante",
    DATABASE_URL: process.env.DATABASE_URL ? "presente" : "mancante",
    RC_USERNAME: process.env.RC_USERNAME ? "presente" : "mancante",
    PORT: process.env.PORT ?? "8080 (default)",
  });
});

// Trigger manuale per testare il workflow PCS
app.post("/trigger/articolo", async (c) => {
  await inngest.send({
    name: "cycling/generate.article",
    data: {},
  });
  return c.json({ success: true, message: "Workflow avviato!" });
});

// Export CSV risultati (molto utile per i file FCI)
app.get("/gara/csv/:externalId", async (c) => {
  const id = decodeURIComponent(c.req.param("externalId"));
  try {
    const res = await pool.query(
      `SELECT rr.position, rr.cyclist_name, rr.team_name, rr.time_gap
       FROM race_results rr
       JOIN races r ON r.id = rr.race_id
       WHERE r.external_id = $1
       ORDER BY rr.position`,
      [id]
    );
    const csv = "Posizione,Nome,Squadra,Distacco\n" +
      res.rows
        .map((r: any) => `${r.position},"${r.cyclist_name}","${r.team_name}","${r.time_gap}"`)
        .join("\n");
    
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="risultati-${id}.csv"`);
    return c.body(csv);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Pagina di stato
app.get("/", (c) => {
  return c.json({
    status: "online",
    service: "RadioCiclismo AI Journalist",
    version: "v6",
    functions_active: allInngestFunctions.length
  });
});

// 4. Avvio Server e DB
const port = Number(process.env.PORT) || 8080;

ensurePublishedArticlesTable()
  .then(() => {
    console.log("✅ Database pronto");
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
    console.log(`🚀 RadioCiclismo online sulla porta ${port}`);
  })
  .catch((err) => {
    console.error("❌ Errore critico database:", err.message);
    // Avviamo comunque il server per permettere il debug via /debug
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  });
