import { PostgresStorage } from "@mastra/pg";

// Assicurati che DATABASE_URL sia corretta nelle enviroment variables di Vercel
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

export const sharedPostgresStorage = new PostgresStorage({
  connectionString: process.env.DATABASE_URL,
});
