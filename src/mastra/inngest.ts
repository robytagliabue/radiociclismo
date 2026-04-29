import { inngest } from "../client.js";
import { cyclingDispatchFn, cyclingProcessRaceFn } from "./cycling-pcs.js";
import { fciWorkflowFn } from "./cycling-fci.js";

// 1. DEFINISCI PRIMA IL CRON (Spostalo sopra l'array)
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

// 2. ORA PUOI ESPORTARE L'ARRAY (Dopo che tutto è stato definito)
export const allInngestFunctions = [
  cyclingDispatchFn,
  cyclingProcessRaceFn,
  fciWorkflowFn,
  masterCron // Ora masterCron è stato già inizializzato e non darà errore
];
