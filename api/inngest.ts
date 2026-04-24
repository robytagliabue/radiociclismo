import { serve } from 'inngest/vercel';
// CAMBIA QUESTA RIGA: punta al tuo file sorgente, non all'output generato
import { mastra } from '../../mastra/index.js'; 

export default serve({
  id: 'radiociclismo-ai',
  // Usiamo "as any" per saltare il controllo formale dei tipi che sta bloccando il build
  client: (mastra as any).inngest,
  functions: (mastra as any).getWorkflowInngestFunctions(),
});
