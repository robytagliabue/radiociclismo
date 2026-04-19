import { PostgresStore } from "@mastra/pg";

// Usiamo solo la variabile d'ambiente senza alternative locali
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("ERRORE: DATABASE_URL non trovata nelle variabili d'ambiente!");
}

export const sharedPostgresStorage = new PostgresStore({
  connectionString: connectionString,
});
