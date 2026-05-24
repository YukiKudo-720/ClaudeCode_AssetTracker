import type { Adapter } from '../types.js';
import { scrapeMoneyForward } from './scraper.js';

export const moneyforwardAdapter: Adapter = {
  source: 'moneyforward',
  label: 'MoneyForward',
  async run(ctx) {
    ctx.logger.info({ source: 'moneyforward' }, 'starting MF scrape');
    const accountUpdates = await scrapeMoneyForward({ headless: true });
    ctx.logger.info({ source: 'moneyforward', count: accountUpdates.length }, 'MF scrape complete');
    return { accountUpdates };
  },
};
