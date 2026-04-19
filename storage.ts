import { PostgresStorage } from "@mastra/core/storage";

// Istanza condivisa per il database Supabase
export const sharedPostgresStorage = new PostgresStorage({
  connectionString: process.env.DATABASE_URL!,
});
