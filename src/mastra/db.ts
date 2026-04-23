import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export { pool };
export const getPool = () => pool;

export async function ensurePublishedArticlesTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS published_articles (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE,
        title_it TEXT,
        content_it TEXT,
        title_en TEXT,
        content_en TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS workflow_locks (
        id TEXT PRIMARY KEY,
        locked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS races (
        id SERIAL PRIMARY KEY,
        external_id TEXT UNIQUE,
        name TEXT,
        date DATE,
        category TEXT,
        status TEXT DEFAULT 'completed'
      );
      CREATE TABLE IF NOT EXISTS race_results (
        id SERIAL PRIMARY KEY,
        race_id INTEGER REFERENCES races(id) ON DELETE CASCADE,
        position INTEGER,
        cyclist_name TEXT,
        team_name TEXT,
        time_gap TEXT,
        is_official BOOLEAN DEFAULT true,
        UNIQUE(race_id, position)
      );
    `);
  } finally {
    client.release();
  }
}

export async function acquireWorkflowLock() {
  try {
    const res = await pool.query(
      `INSERT INTO workflow_locks (id) VALUES ('cycling_sync') ON CONFLICT (id) DO NOTHING RETURNING id`
    );
    return res.rowCount !== null && res.rowCount > 0;
  } catch (e) { return false; }
}

export async function releaseWorkflowLock() {
  await pool.query(`DELETE FROM workflow_locks WHERE id = 'cycling_sync'`);
}

export async function saveRaceResults(raceData: {
  externalId: string;
  name: string;
  results: Array<{ position: number; name: string; team: string; gap: string }>;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const raceRes = await client.query(
      `INSERT INTO races (external_id, name, date) 
       VALUES ($1, $2, CURRENT_DATE) 
       ON CONFLICT (external_id) DO UPDATE SET name = $2 
       RETURNING id`,
      [raceData.externalId, raceData.name]
    );
    const raceId = raceRes.rows[0].id;
    for (const row of raceData.results) {
      await client.query(
        `INSERT INTO race_results (race_id, position, cyclist_name, team_name, time_gap)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (race_id, position) DO UPDATE SET 
         cyclist_name = $3, team_name = $4, time_gap = $5`,
        [raceId, row.position, row.name, row.team, row.gap]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function savePendingArticles(articles: any[]) {
  const client = await pool.connect();
  try {
    for (const art of articles) {
      // Corretto il template literal qui sotto per evitare errori di build
      const slug = art.slug || `race-${Date.now()}`;
      await client.query(
        `INSERT INTO published_articles (slug, title_it, content_it, title_en, content_en) 
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING`,
        [slug, art.titleIt, art.contentIt, art.titleEn, art.contentEn]
      );
    }
  } finally { client.release(); }
}
