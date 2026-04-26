 import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "radiociclismo",
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

export const CYCLING_WORKFLOW_EVENT = "cycling/generate.article";
