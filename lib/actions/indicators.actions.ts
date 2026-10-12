'use server';

import { getDailyCandles } from './alpaca.actions';
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

/** 1 小時快取由統一入口 getDailyCandles 繼承。 */
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
 * 57-indicator vote + IDS assessment for a US stock or CoinGecko crypto symbol.
 * CG: 幣種走統一入口（CoinGecko 查 symbol → Alpaca 幣 K 線）。
 * Returns null (never throws) when: there is no usable candle data,
 * or fewer than 60 candles are available.
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
    if (!symbol) return { assessment: null, reason: 'api-error' };

    // days=400 guarantees 250+ trading days for SMA200 after holidays/gaps.
    // 統一入口：美股走 Alpaca（Finnhub 備援）；CG: 幣種走 CoinGecko 查 symbol → Alpaca。
    const [symR, spyR] = await Promise.allSettled([
      getDailyCandles(symbol, 400),
      getDailyCandles('SPY', 400),
    ]);

    const raw = symR.status === 'fulfilled' ? symR.value : null;
    if (!raw || !Array.isArray(raw.c) || raw.c.length === 0) {
      console.error(`[indicators] candle API failed for ${symbol}: no usable response`);
      // 幣種無資料（無法對應或 Alpaca 無此幣）→ 'crypto'；
      // 美股無資料（Alpaca＋Finnhub 皆失敗）→ 'api-error'。
      return {
        assessment: null,
        reason: symbol.toUpperCase().startsWith('CG:') ? 'crypto' : 'api-error',
      };
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
 * Four-factor (T/M/V/R) + variant + IDS assessment for a US stock or CoinGecko crypto symbol.
 * Returns null (never throws) when: there is no usable candle data,
 * or fewer than 60 candles are available.
 * 1 小時快取由統一入口 getDailyCandles 繼承。
 */
export async function getFactorAssessment(
  symbol: string,
): Promise<FactorAssessment | null> {
  try {
    if (!symbol) return null;

    // days=400 gives R the longest possible ATR% history (up to 252 closes).
    // 統一入口：美股走 Alpaca（Finnhub 備援）；CG: 幣種走 CoinGecko 查 symbol → Alpaca。
    const raw = await getDailyCandles(symbol, 400);
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
