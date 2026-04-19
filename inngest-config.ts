import { inngest } from "./client.js"; // Aggiunto .js
import { init, serve as originalInngestServe } from "@mastra/inngest";
import { registerApiRoute as originalRegisterApiRoute } from "@mastra/core/server";
import { type Mastra } from "@mastra/core";
import { type Inngest, InngestFunction, NonRetriableError } from "inngest";

// Inizializza Mastra con il client Inngest locale
const {
  createWorkflow: originalCreateWorkflow,
  createStep,
  cloneStep,
} = init(inngest);

export function createWorkflow(
  params: Parameters<typeof originalCreateWorkflow>[0],
): ReturnType<typeof originalCreateWorkflow> {
  return originalCreateWorkflow({
    ...params,
    retryConfig: {
      attempts: process.env.NODE_ENV === "production" ? 3 : 0,
      ...(params.retryConfig ?? {}),
    },
  });
}

export { inngest, createStep, cloneStep };

const inngestFunctions: InngestFunction.Any[] = [];

// --- TRIGGER MANUALE (Per testare da Dashboard Inngest) ---
export function registerManualTrigger(workflow: any) {
  const manualFunction = inngest.createFunction(
    { id: "manual-trigger", concurrency: { limit: 1 } },
    { event: "cycling/manual.trigger" }, // Nome evento pulito
    async ({ step }) => {
      return await step.run("execute-manual-workflow", async () => {
        try {
          const run = await workflow.createRunAsync();
          const result = await inngest.send({
            name: `workflow.${workflow.id}`,
            data: { runId: run?.runId, inputData: {} },
          });
          return result;
        } catch (error) {
          throw error;
        }
      });
    }
  );
  inngestFunctions.push(manualFunction);
}

// --- TRIGGER CRON (Per l'automazione giornaliera) ---
export function registerCronWorkflow(cronExpression: string, workflow: any) {
  const cronFunction = inngest.createFunction(
    { id: "cron-trigger", concurrency: { limit: 1 } },
    [{ event: "cycling/cron.trigger" }, { cron: cronExpression }],
    async ({ event, step }) => {
      return await step.run("execute-cron-workflow", async () => {
        try {
          const run = await workflow.createRunAsync();
          const result = await inngest.send({
            name: `workflow.${workflow.id}`,
            data: { runId: run?.runId, inputData: {} },
          });
          return result;
        } catch (error) {
          throw error;
        }
      });
    }
  );
  inngestFunctions.push(cronFunction);
}

// --- FUNZIONE SERVE (Quella che Vercel espone) ---
export function inngestServe({
  mastra,
  inngest,
}: {
  mastra: Mastra;
  inngest: Inngest;
}): ReturnType<typeof originalInngestServe> {
  // Rileva automaticamente l'URL di Vercel o usa localhost in sviluppo
  const serveHost = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : "http://localhost:3000";

  return originalInngestServe({
    mastra,
    inngest,
    functions: inngestFunctions,
    registerOptions: { 
        serveHost,
        // Su Vercel è meglio specificare la signing key se hai problemi di connessione
        signingKey: process.env.INNGEST_SIGNING_KEY 
    },
  });
}
