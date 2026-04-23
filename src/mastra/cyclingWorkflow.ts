import { workflow as MastraWorkflow } from 'mastra';
import { z } from 'zod';

export const cyclingWorkflow = new MastraWorkflow({
  name: 'cycling-sync',
  triggerSchema: z.object({
    raceUrl: z.string(),
    raceName: z.string(),
  }),
})
.step('analyze', {
  execute: async ({ context }) => {
    return { success: true };
  },
})
.commit();

