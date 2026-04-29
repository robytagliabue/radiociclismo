import { Inngest } from "inngest";

export const inngest = new Inngest({ 
  id: "radiociclismo",
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

// Stringhe eventi per evitare refusi
export const PCS_EVENT = "cycling/generate.article";
export const FCI_EVENT = "cycling/generate.fci.article";
export const PROCESS_SINGLE_EVENT = "cycling/process.single.race";
