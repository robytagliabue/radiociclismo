import { inngest } from "../client.js"; // Esce in src per prendere il client
import { cyclingDispatchFn, cyclingProcessRaceFn } from "./cycling-pcs.js"; // ./ perché sono in mastra
import { fciWorkflowFn } from "./cycling-fci.js"; // ./ perché sono in mastra

export const allInngestFunctions = [
  cyclingDispatchFn,
  cyclingProcessRaceFn,
  fciWorkflowFn,
  masterCron // Ricordati di aggiungere masterCron qui se vuoi che sia registrato!
];
// CRON UNICO: Evitiamo sovrapposizioni per non esaurire i 5 slot di concurrency
export const masterCron = inngest.createFunction(
  { id: "master-cron-radiociclismo", name: "RadioCiclismo Master Cron" },
  { cron: "0 18 * * *" }, 
  async ({ step }) => {
    // 1. Prima scansioniamo le internazionali (PCS)
    await step.sendEvent("start-pcs", { name: "cycling/generate.article" });

    // 2. Aspettiamo 10 minuti che finiscano (per stare nei limiti Free)
    await step.sleep("wait-for-fci", "10m");

    // 3. Poi facciamo partire le giovanili italiane (FCI)
    await step.sendEvent("start-fci", { name: "cycling/generate.fci.article" });
  }
);
