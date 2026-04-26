import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "radiociclismo",
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

export const CYCLING_WORKFLOW_EVENT = "cycling/generate.article";

/**
 * Nome del trigger per il workflow di generazione articoli
 */
export const CYCLING_WORKFLOW_EVENT = "cycling/generate.article";

/**
 * Nota: Se in futuro vorrai aggiungere gli Schemas per il completamento automatico,
 * dovrai importare { EventSchemas } da "inngest".
 */
