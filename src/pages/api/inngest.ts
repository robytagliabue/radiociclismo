// @ts-ignore
import { serve } from 'inngest/vercel';
// @ts-ignore
import { mastra } from '../../mastra/index'; 

/**
 * Questo è l'endpoint che permette a Inngest Cloud di 
 * comunicare con il tuo motore Mastra su Vercel.
 */
export default serve({
  id: 'radiociclismo-ai',
  // @ts-ignore
  client: mastra.inngest,
  // @ts-ignore
  functions: mastra.getWorkflowInngestFunctions(),
});
