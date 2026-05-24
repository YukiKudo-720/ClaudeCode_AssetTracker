import { prisma } from './db.js';
import type { Logger } from 'pino';

const RATE_TTL_HOURS = 6;

interface RateProviderResponse {
  rates: Record<string, number>;
}

async function fetchRateFromApi(base: string, quote: string): Promise<number> {
  if (base === quote) return 1;
  const url = `https://api.exchangerate.host/latest?base=${base}&symbols=${quote}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fx fetch failed: ${res.status}`);
  const json = (await res.json()) as RateProviderResponse;
  const rate = json.rates[quote];
  if (typeof rate !== 'number') throw new Error(`fx rate missing: ${base}->${quote}`);
  return rate;
}

/** {base} → JPY のレートを取得 (DB キャッシュ TTL 6h) */
export async function getRateToJpy(base: string, logger?: Logger): Promise<number> {
  if (base === 'JPY') return 1;

  const cutoff = new Date(Date.now() - RATE_TTL_HOURS * 60 * 60 * 1000);
  const cached = await prisma.fxRate.findFirst({
    where: { base, quote: 'JPY', capturedAt: { gte: cutoff } },
    orderBy: { capturedAt: 'desc' },
  });
  if (cached) return Number(cached.rate);

  try {
    const rate = await fetchRateFromApi(base, 'JPY');
    await prisma.fxRate.create({
      data: { base, quote: 'JPY', rate, capturedAt: new Date() },
    });
    return rate;
  } catch (err) {
    logger?.warn({ err, base }, 'fx fetch failed, falling back to last known rate');
    const fallback = await prisma.fxRate.findFirst({
      where: { base, quote: 'JPY' },
      orderBy: { capturedAt: 'desc' },
    });
    if (fallback) return Number(fallback.rate);
    throw err;
  }
}

/** 同一 run 内で複数回呼ばれた場合に再fetch しないキャッシュ */
export function createFxCache(logger?: Logger): (base: string) => Promise<number> {
  const cache = new Map<string, Promise<number>>();
  return (base: string) => {
    if (!cache.has(base)) cache.set(base, getRateToJpy(base, logger));
    return cache.get(base)!;
  };
}
