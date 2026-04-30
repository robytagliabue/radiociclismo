/**
 * db.ts  →  src/mastra/db.ts
 * Connessione PostgreSQL e utility DB per il workflow RadioCiclismo.
 *
 * Funzioni attive:
 *  - pool / getPool         → usato da cycling-fci.ts (getGareFCIOggi)
 *  - saveRaceResults        → usato dal CSV worker PCS
 *
 * Rimosso:
 *  - ensurePublishedArticlesTable  → tabelle non più necessarie
 *  - acquireWorkflowLock           → sostituito da concurrency Inngest
 *  - releaseWorkflowLock           → sostituito da concurrency Inngest
 *  - savePendingArticles           → pubblicazione ora diretta via API RC
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export { pool };
export const getPool = () => pool;

// ─── Salva risultati di una gara nel DB ───────────────────────────────────────
// Chiamato dal CSV worker PCS dopo import dei risultati ufficiali.
// Usa ON CONFLICT per idempotenza — sicuro da chiamare più volte.
export async function saveRaceResults(raceData: {
  externalId: string;
  name: string;
  results: Array<{ position: number; name: string; team: string; gap: string }>;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Upsert della gara
    const raceRes = await client.query(
      `INSERT INTO races (external_id, name, date)
       VALUES ($1, $2, CURRENT_DATE)
       ON CONFLICT (external_id) DO UPDATE SET name = $2
       RETURNING id`,
      [raceData.externalId, raceData.name]
    );
    const raceId = raceRes.rows[0].id;

    // Upsert dei risultati
    for (const row of raceData.results) {
      await client.query(
        `INSERT INTO race_results (race_id, position, cyclist_name, team_name, time_gap)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (race_id, position) DO UPDATE SET
           cyclist_name = $3,
           team_name    = $4,
           time_gap     = $5`,
        [raceId, row.position, row.name, row.team, row.gap]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
