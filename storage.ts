import { PostgresStorage } from '@mastra/core/storage';

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL non configurata su Vercel!");
}

export const sharedPostgresStorage = new PostgresStorage({
  connectionString: process.env.DATABASE_URL,
});
