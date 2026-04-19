import { PgStorage } from "@mastra/pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL non configurata su Vercel!");
}

// In Mastra v0.x la classe corretta si chiama PgStorage
export const sharedPostgresStorage = new PgStorage({
  connectionString: process.env.DATABASE_URL,
});
