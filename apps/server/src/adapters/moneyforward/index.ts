import type { Adapter } from '../types.js';
import { scrapeMoneyForward } from './scraper.js';

export const moneyforwardAdapter: Adapter = {
  source: 'moneyforward',
  label: 'MoneyForward',
  async run(ctx) {
    const headless = process.env.HEADFUL !== '1';
    ctx.logger.info({ source: 'moneyforward', headless }, 'starting MF scrape');
    const accountUpdates = await scrapeMoneyForward({ headless });
    ctx.logger.info({ source: 'moneyforward', count: accountUpdates.length }, 'MF scrape complete');
    return { accountUpdates };
  },
};
