'use server';

import { getCandles } from './finnhub.actions';
import { computeAll } from '../indicators';
import type { Candle, IDSResult, IndicatorResult } from '../indicators/types';

/** 1-hour cache is inherited from getCandles' fetchJSON(url, 3600). */
export interface IndicatorAssessment {
  results: IndicatorResult[];
  ids: IDSResult;
  asof: string;
  symbol: string;
}

/** Convert a raw Finnhub candle response into aligned Candle[]; skips any
 * index where one of t/o/h/l/c/v is missing or not a finite number. */
function toCandles(raw: {
  c: number[];
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  v: number[];
}): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < raw.c.length; i++) {
    const vals = [raw.t[i], raw.o[i], raw.h[i], raw.l[i], raw.c[i], raw.v[i]];
    if (!vals.every((x) => typeof x === 'number' && Number.isFinite(x))) continue;
    out.push({ t: raw.t[i], o: raw.o[i], h: raw.h[i], l: raw.l[i], c: raw.c[i], v: raw.v[i] });
  }
  return out;
}

/**
 * 57-indicator vote + IDS assessment for a US stock symbol.
 * Returns null (never throws) when: symbol is CoinGecko-prefixed (CG:...),
 * there is no usable candle data, or fewer than 60 candles are available.
 */
export async function getIndicatorAssessment(
  symbol: string,
): Promise<IndicatorAssessment | null> {
  try {
    // Crypto prices come from CoinGecko, not Finnhub: no candle data available.
    if (!symbol || symbol.startsWith('CG:')) return null;

    // days=400 guarantees 250+ trading days for SMA200 after holidays/gaps.
    const [symR, spyR] = await Promise.allSettled([
      getCandles(symbol, 'D', 400),
      getCandles('SPY', 'D', 400),
    ]);

    const raw = symR.status === 'fulfilled' ? symR.value : null;
    if (!raw || !Array.isArray(raw.c) || raw.c.length < 60) return null;

    const candles = toCandles(raw);
    if (candles.length < 60) return null;

    // SPY failure is non-fatal: breadth falls back to market-wide mode.
    const spyRaw = spyR.status === 'fulfilled' ? spyR.value : null;
    const spyCandles = spyRaw && Array.isArray(spyRaw.c) ? toCandles(spyRaw) : null;

    const { results, ids } = computeAll(candles, spyCandles);
    return {
      results,
      ids,
      asof: new Date(candles[candles.length - 1].t * 1000).toISOString(),
      symbol,
    };
  } catch {
    // Server action contract: never throw.
    return null;
  }
}
