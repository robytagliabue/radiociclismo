/**
 * inngest.ts  →  src/mastra/inngest.ts
 */

import { inngest } from "../client.js";
import { cyclingDispatchFn, cyclingProcessRaceFn } from "./cycling-pcs.js";
import { fciWorkflowFn } from "./cycling-fci.js";

export const masterCron = inngest.createFunction(
  { id: "master-cron-radiociclismo", name: "RadioCiclismo Master Cron" },
  { event: "cycling/master.run" }, // ← trigger manuale dal dashboard Inngest
  async ({ step }) => {
    // 1. Internazionali (PCS)
    await step.sendEvent("start-pcs", { name: "cycling/generate.article", data: {} });

    // 2. Attendi che i worker PCS completino prima di avviare FCI
    await step.sleep("wait-for-fci", "15m");

    // 3. Nazionali e Giovanili (FCI)
    await step.sendEvent("start-fci", { name: "cycling/generate.fci.article", data: {} });
  }
);

export const allInngestFunctions = [
  cyclingDispatchFn,
  cyclingProcessRaceFn,
  fciWorkflowFn,
  masterCron,
];
