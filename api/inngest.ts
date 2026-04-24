// @ts-ignore
import { serve } from 'inngest/vercel';
// @ts-ignore
import { mastra } from '../../mastra/index'; // Togli il .js, TypeScript preferisce senza o lo risolve lui

export default serve({
  id: 'radiociclismo-ai',
  // @ts-ignore
  client: mastra.inngest,
  // @ts-ignore
  functions: mastra.getWorkflowInngestFunctions(),
});
