import { Workflow } from 'mastra';
import { z } from 'zod';

export const cyclingWorkflow = new Workflow({
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
