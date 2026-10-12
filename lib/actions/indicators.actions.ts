'use server';

import { getCandles } from './finnhub.actions';
import { computeAll } from '../indicators';
import { computeFactors } from '../indicators/factors';
import { computeVariants } from '../indicators/variants';
import { computeIDSFactor, computeIDSPeriod } from '../indicators/ids';
import type { Candle, IDSResult, IndicatorResult } from '../indicators/types';
import type { FourFactors } from '../indicators/factors';
import type {
  VariantIndicatorId,
  VariantResult,
} from '../indicators/variants';
import type {
  IDSFactorResult,
  IDSPeriodResult,
} from '../indicators/ids';

/** 1-hour cache is inherited from getCandles' fetchJSON(url, 3600). */
export interface IndicatorAssessment {
  results: IndicatorResult[];
  ids: IDSResult;
  asof: string;
  symbol: string;
}

/** Convert a raw Finnhub candle response into aligned Candle[].
 * Requires t/o/h/l/c to be finite numbers; volume (v) is optional and
 * defaults to 0 when missing (volume indicators show N/A for those). */
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
    const vals = [raw.t[i], raw.o[i], raw.h[i], raw.l[i], raw.c[i]];
    if (!vals.every((x) => typeof x === 'number' && Number.isFinite(x))) continue;
    const v = typeof raw.v[i] === 'number' && Number.isFinite(raw.v[i]) ? raw.v[i] : 0;
    out.push({ t: raw.t[i], o: raw.o[i], h: raw.h[i], l: raw.l[i], c: raw.c[i], v });
  }
  return out;
}

/** Why an assessment could not be produced (for UI messaging). */
export type AssessmentFailureReason = 'crypto' | 'api-error' | 'insufficient-data';

/**
 * 57-indicator vote + IDS assessment for a US stock symbol.
 * Returns null (never throws) when: symbol is CoinGecko-prefixed (CG:...),
 * there is no usable candle data, or fewer than 60 candles are available.
 */
export async function getIndicatorAssessment(
  symbol: string,
): Promise<IndicatorAssessment | null> {
  const result = await getIndicatorAssessmentWithReason(symbol);
  return result.assessment;
}

/**
 * Same as getIndicatorAssessment but also reports why it failed,
 * so the UI can distinguish an API outage from genuinely short history.
 */
export async function getIndicatorAssessmentWithReason(
  symbol: string,
): Promise<{ assessment: IndicatorAssessment | null; reason: AssessmentFailureReason | null }> {
  try {
    // Crypto prices come from CoinGecko, not Finnhub: no candle data available.
    if (!symbol || symbol.startsWith('CG:')) return { assessment: null, reason: 'crypto' };

    // days=400 guarantees 250+ trading days for SMA200 after holidays/gaps.
    const [symR, spyR] = await Promise.allSettled([
      getCandles(symbol, 'D', 400),
      getCandles('SPY', 'D', 400),
    ]);

    const raw = symR.status === 'fulfilled' ? symR.value : null;
    if (!raw || !Array.isArray(raw.c) || raw.c.length === 0) {
      console.error(`[indicators] candle API failed for ${symbol}: no usable response`);
      return { assessment: null, reason: 'api-error' };
    }
    if (raw.c.length < 60) {
      return { assessment: null, reason: 'insufficient-data' };
    }

    const candles = toCandles(raw);
    if (candles.length < 60) {
      console.error(
        `[indicators] candle filtering dropped too many for ${symbol}: ${raw.c.length} -> ${candles.length}`,
      );
      return { assessment: null, reason: 'insufficient-data' };
    }

    // SPY failure is non-fatal: breadth falls back to market-wide mode.
    const spyRaw = spyR.status === 'fulfilled' ? spyR.value : null;
    const spyCandles = spyRaw && Array.isArray(spyRaw.c) ? toCandles(spyRaw) : null;

    const { results, ids } = computeAll(candles, spyCandles);
    return {
      assessment: {
        results,
        ids,
        asof: new Date(candles[candles.length - 1].t * 1000).toISOString(),
        symbol,
      },
      reason: null,
    };
  } catch (e) {
    // Server action contract: never throw.
    console.error(`[indicators] unexpected error for ${symbol}:`, e);
    return { assessment: null, reason: 'api-error' };
  }
}

/** v1.1 factor assessment: four factors + multi-period variants + IDS levels 1 & 3. */
export interface FactorAssessment {
  factors: FourFactors;
  variants: Record<string, VariantResult[]>;
  idsPeriod: Record<string, IDSPeriodResult>;
  idsFactor: IDSFactorResult;
  asof: string;
  symbol: string;
}

/** Indicator families with multi-period variants (v1.1 §6.5.1 IDS-Period). */
const VARIANT_INDICATORS: VariantIndicatorId[] = ['RSI', 'ADX_DMI', 'CMF', 'ATR'];

/**
 * Four-factor (T/M/V/R) + variant + IDS assessment for a US stock symbol.
 * Returns null (never throws) when: symbol is CoinGecko-prefixed (CG:...),
 * there is no usable candle data, or fewer than 60 candles are available.
 * 1-hour cache is inherited from getCandles' fetchJSON(url, 3600).
 */
export async function getFactorAssessment(
  symbol: string,
): Promise<FactorAssessment | null> {
  try {
    // Crypto prices come from CoinGecko, not Finnhub: no candle data available.
    if (!symbol || symbol.startsWith('CG:')) return null;

    // days=400 gives R the longest possible ATR% history (up to 252 closes).
    const raw = await getCandles(symbol, 'D', 400);
    if (!raw || !Array.isArray(raw.c) || raw.c.length < 60) return null;

    const candles = toCandles(raw);
    if (candles.length < 60) return null;

    const factors = computeFactors(candles);

    const variants: Record<string, VariantResult[]> = {};
    const idsPeriod: Record<string, IDSPeriodResult> = {};
    for (const id of VARIANT_INDICATORS) {
      const vs = computeVariants(candles, id);
      variants[id] = vs;
      idsPeriod[id] = computeIDSPeriod(vs);
    }

    // computeIDSFactor accepts FourFactors: R is accepted but never votes
    // (signature-level exclusion), T/M/V map structurally.
    const idsFactor = computeIDSFactor(factors);

    return {
      factors,
      variants,
      idsPeriod,
      idsFactor,
      asof: new Date(candles[candles.length - 1].t * 1000).toISOString(),
      symbol,
    };
  } catch {
    // Server action contract: never throw.
    return null;
  }
}
