import { PostgresStore } from "@mastra/pg";

// Verifica che la variabile d'ambiente esista
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL non configurata nelle variabili d'ambiente di Vercel");
}

// In @mastra/pg la classe corretta si chiama PostgresStore
export const sharedPostgresStorage = new PostgresStore({
  connectionString: process.env.DATABASE_URL,
});
