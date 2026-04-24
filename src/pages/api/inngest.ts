// @ts-ignore
import { serve } from 'inngest/vercel';
// @ts-ignore
import { mastra } from '../../mastra/index'; 

export default serve({
  id: 'radiociclismo-ai',
  // @ts-ignore
  client: mastra.inngest,
  // @ts-ignore
  functions: mastra.getWorkflowInngestFunctions(),
});
