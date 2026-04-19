import { PostgresStorage } from "@mastra/pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL non configurata su Vercel!");
}

export const sharedPostgresStorage = new PostgresStorage({
  connectionString: process.env.DATABASE_URL,
});
