import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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

export async function savePendingArticles(articles: any[]) {
  const client = await pool.connect();
  try {
    for (const art of articles) {
      await client.query(
        `INSERT INTO published_articles (slug, title_it, content_it, title_en, content_en) 
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING`,
        [art.slug || `race-${Date.now()}`, art.titleIt, art.contentIt, art.titleEn, art.contentEn]
      );
    }
  } finally { client.release(); }
}
