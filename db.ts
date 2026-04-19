import pg from 'pg';

const { Pool } = pg;

/**
 * Configurazione del pool di connessione.
 * DATABASE_URL deve essere impostata nelle Environment Variables di Vercel.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Necessario per connettersi in modo sicuro a Supabase/Neon
  },
});

export const getPool = () => pool;

/**
 * Crea le tabelle se non esistono al momento del primo avvio.
 */
export async function ensurePublishedArticlesTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Tabella per archiviare gli articoli generati
      CREATE TABLE IF NOT EXISTS published_articles (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE,
        title_it TEXT,
        content_it TEXT,
        title_en TEXT,
        content_en TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Tabella per gestire il 'lock' del workflow (evita sovrapposizioni)
      CREATE TABLE IF NOT EXISTS workflow_locks (
        id TEXT PRIMARY KEY,
        locked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database pronto: tabelle verificate.");
  } catch (err) {
    console.error("❌ Errore durante l'inizializzazione del database:", err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Tenta di acquisire un lock per il workflow.
 * Ritorna true se il lock è stato acquisito, false se è già impegnato.
 */
export async function acquireWorkflowLock() {
  try {
    const res = await pool.query(
      `INSERT INTO workflow_locks (id) VALUES ('cycling_sync') 
       ON CONFLICT (id) DO NOTHING 
       RETURNING id`
    );
    return res.rowCount !== null && res.rowCount > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Rilascia il lock al termine del lavoro.
 */
export async function releaseWorkflowLock() {
  try {
    await pool.query(`DELETE FROM workflow_locks WHERE id = 'cycling_sync'`);
  } catch (e) {
    console.error("❌ Impossibile rilasciare il lock:", e);
  }
}

/**
 * Salva gli articoli prodotti dall'Agente nel database.
 */
export async function savePendingArticles(articles: any[]) {
  const client = await pool.connect();
  try {
    for (const art of articles) {
      await client.query(
        `INSERT INTO published_articles (slug, title_it, content_it, title_en, content_en) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (slug) DO NOTHING`,
        [
          art.slug || `race-${Date.now()}`, 
          art.titleIt, 
          art.contentIt, 
          art.titleEn, 
          art.contentEn
        ]
      );
    }
  } catch (err) {
    console.error("❌ Errore durante il salvataggio degli articoli:", err);
  } finally {
    client.release();
  }
}
