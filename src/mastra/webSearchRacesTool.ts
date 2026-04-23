import { createTool } from 'mastra';
import { z } from 'zod';

export const webRaceTool = createTool({
  id: 'web-race-tool',
  description: 'Recupera dati da ProCyclingStats superando i blocchi Cloudflare.',
  inputSchema: z.object({
    url: z.string().url(),
  }),
  execute: async ({ input }) => {
    // Configurazione Header moderni per bypassare Cloudflare
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="135", "Chromium";v="135"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    };

    // Esecuzione con supporto HTTP/2 (fetch in Node 22 lo gestisce bene)
    const response = await fetch(input.url, { headers });
    const html = await response.text();

    return {
      data: html.substring(0, 5000), // Ritorna solo una parte per non intasare l'LLM
    };
  },
});
