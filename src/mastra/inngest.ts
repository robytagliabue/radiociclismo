import { Inngest } from "inngest";

/**
 * CLIENT INNGEST PER RADIOCICLISMO
 * * NOTA TECNICA: Abbiamo rimosso il realtimeMiddleware() per evitare l'errore 
 * NESTING_STEPS dell'SDK Inngest v3.54.0+. Questo accadeva perché Mastra 
 * chiamava internamente publish() dentro uno step.run(), mandando il workflow in loop.
 */

export const inngest = new Inngest({ 
  id: "radiociclismo-app",
  // Il middleware viene lasciato vuoto (o rimosso il realtime) per stabilità
  middleware: [] 
});

/**
 * Esempio di definizione del nome del trigger per il workflow
 */
export const CYCLING_WORKFLOW_EVENT = "cycling/generate.article";

/**
 * Se hai bisogno di definire tipi per gli eventi, puoi farlo qui sotto:
 * (Opzionale, utile per mantenere il codice pulito)
 */
/*
export const inngestClient = new Inngest({
  id: "radiociclismo-app",
  schemas: new EventSchemas().fromRecord<{
    [CYCLING_WORKFLOW_EVENT]: {
      data: {
        raceUrl: string;
        style?: string;
      };
    };
  }>(),
});
*/
