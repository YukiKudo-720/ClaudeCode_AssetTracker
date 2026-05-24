import type { Adapter } from '../types.js';
import { scrapeMoneyForward } from './scraper.js';

export const moneyforwardAdapter: Adapter = {
  source: 'moneyforward',
  label: 'MoneyForward',
  async run(ctx) {
    // MF はヘッドレス Chromium を 403 Forbidden で弾くため、デフォルトヘッドフル。
    // HEADLESS=1 で opt-in (将来 stealth plugin 入れたら headless 動くかも)
    const headless = process.env.HEADLESS === '1';
    ctx.logger.info({ source: 'moneyforward', headless }, 'starting MF scrape');
    const accountUpdates = await scrapeMoneyForward({
      headless,
      getFxToJpy: ctx.getFxToJpy, // cash native 換算に必要
    });
    ctx.logger.info({ source: 'moneyforward', count: accountUpdates.length }, 'MF scrape complete');
    return { accountUpdates };
  },
};
