import { createWorkflow } from '@mastra/core';
import { z } from 'zod';
import { cyclingAgent } from './cyclingAgent.js';
import { saveRaceResults, savePendingArticles } from './db.js';

export const cyclingWorkflow = createWorkflow({
  name: 'cycling-sync',
  inputs: {
    raceUrl: z.string(),
    raceName: z.string(),
  },
  steps: {
    fetchAndProcess: {
      handler: async ({ context }) => {
        const { raceUrl, raceName } = context.inputs;

        const result = await cyclingAgent.generate(
          `Analizza la gara ${raceName} dall'URL ${raceUrl}. 
           Estrai la Top 10 e scrivi un articolo unico in italiano e inglese.`
        );

        const raceId = raceUrl.split('/').filter(Boolean).pop() || 'race';

        await saveRaceResults({
          externalId: raceId,
          name: raceName,
          results: result.object?.top10 || [],
        });

        await savePendingArticles([{
          slug: raceId,
          titleIt: raceName,
          contentIt: result.text,
          titleEn: raceName + " Results",
          contentEn: "Auto-translated content"
        }]);

        return { success: true };
      },
    },
  },
});
