// Aggiungi questa route al server esistente
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

// Route per scaricare CSV di una gara
app.get("/gara/csv/:externalId", async (c) => {
  const { pool } = await import("./db.js");
  const id = decodeURIComponent(c.req.param("externalId"));

  const res = await pool.query(
    `SELECT rr.position, rr.cyclist_name, rr.team_name, rr.time_gap
     FROM race_results rr
     JOIN races r ON r.id = rr.race_id
     WHERE r.external_id = $1
     ORDER BY rr.position`,
    [id]
  );

  const csv = "Posizione,Nome,Squadra,Distacco\n" +
    res.rows.map((r: any) => `${r.position},"${r.cyclist_name}","${r.team_name}","${r.time_gap}"`).join("\n");

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="risultati.csv"`);
  return c.body(csv);
});
