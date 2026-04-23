import { Inngest } from "inngest";

/**
 * CLIENT INNGEST PER RADIOCICLISMO
 * Soluzione al problema NESTING_STEPS: rimosso il realtimeMiddleware.
 */
export const inngest = new Inngest({ 
  id: "radiociclismo-app",
  middleware: [] 
});

/**
 * Nome del trigger per il workflow di generazione articoli
 */
export const CYCLING_WORKFLOW_EVENT = "cycling/generate.article";

/**
 * Nota: Se in futuro vorrai aggiungere gli Schemas per il completamento automatico,
 * dovrai importare { EventSchemas } da "inngest".
 */
