// Suppress Mastra v0.14.1 internal watcher bug:
process.on("uncaughtException", (err) => {
  if (
    err instanceof TypeError &&
    err.message.includes("workflowState")
  ) {
    console.warn(
      "⚠️ [Mastra] Suppressed internal watcher bug (workflowState undefined) — workflow continues normally"
    );
    return;
  }
  console.error("💥 [uncaughtException] Unhandled error:", err);
  process.exit(1);
});

import { Mastra } from "@mastra/core";
import { MastraError } from "@mastra/core/error";
import { PinoLogger } from "@mastra/loggers";
import { LogLevel, MastraLogger } from "@mastra/core/logger";
import pino from "pino";
import { NonRetriableError } from "inngest";
import { z } from "zod";

// IMPORT LOCALI (Tutti i file sono nella stessa cartella root)
import { sharedPostgresStorage } from "./storage.js";
import { inngest, inngestServe, registerManualTrigger } from "./inngest.js";
import { cyclingAgent } from "./cyclingAgent.js";
import { cyclingWorkflow } from "./cyclingWorkflow.js";
import { ensurePublishedArticlesTable } from "./db.js";

// Inizializzazione tabelle Database
ensurePublishedArticlesTable().catch((err) => {
  console.warn("⚠️ [startup] Could not ensure published_articles table:", err.message);
});

// Registra il trigger manuale per far partire il workflow da Inngest
registerManualTrigger(cyclingWorkflow);

// Configurazione Logger per Produzione (Vercel)
class ProductionPinoLogger extends MastraLogger {
  protected logger: pino.Logger;

  constructor(
    options: {
      name?: string;
      level?: LogLevel;
    } = {},
  ) {
    super(options);

    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label: string) => ({
          level: label,
        }),
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    });
  }

  debug(message: string, args: Record<string, any> = {}): void {
    this.logger.debug(args, message);
  }

  info(message: string, args: Record<string, any> = {}): void {
    this.logger.info(args, message);
  }

  warn(message: string, args: Record<string, any> = {}): void {
    this.logger.warn(args, message);
  }

  error(message: string, args: Record<string, any> = {}): void {
    this.logger.error(args, message);
  }
}

// ISTANZA PRINCIPALE MASTRA
export const mastra = new Mastra({
  storage: sharedPostgresStorage,
  workflows: { cyclingWorkflow },
  agents: { cyclingAgent },
  bundler: {
    externals: [
      "@slack/web-api",
      "inngest",
      "inngest/hono",
      "hono",
      "hono/streaming",
      "axios",
      "cheerio",
      "pg",
      "pino",
    ],
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    middleware: [
      async (c, next) => {
        const mastra = c.get("mastra");
        const logger = mastra?.getLogger();
        logger?.debug("[Request]", { method: c.req.method, url: c.req.url });
        try {
          await next();
        } catch (error) {
          logger?.error("[Response Error]", {
            method: c.req.method,
            url: c.req.url,
            error,
          });
          if (error instanceof MastraError) {
            if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
              throw new NonRetriableError(error.message, { cause: error });
            }
          } else if (error instanceof z.ZodError) {
            throw new NonRetriableError(error.message, { cause: error });
          }

          throw error;
        }
      },
    ],
    apiRoutes: [
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({ mastra }) => inngestServe({ mastra, inngest }),
      },
    ],
  },
  logger:
    process.env.NODE_ENV === "production"
      ? new ProductionPinoLogger({
          name: "Mastra",
          level: "info",
        })
      : new PinoLogger({
          name: "Mastra",
          level: "info",
        }),
});

// Verifiche di integrità
if (Object.keys(mastra.getWorkflows()).length > 1) {
  throw new Error("More than 1 workflows found.");
}

if (Object.keys(mastra.getAgents()).length > 1) {
  throw new Error("More than 1 agents found.");
}
