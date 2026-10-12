'use server';

import { getDailyCandles, getDailyCandlesWithReason } from './alpaca.actions';
import { candleMarket } from '../candles/symbols';
import type { CandleFailureReason, CandleSource } from '../candles/types';
import { computeAll } from '../indicators';
import { computeFactors } from '../indicators/factors';
import { computeVariants } from '../indicators/variants';
import { computeIDS, computeIDSFactor, computeIDSPeriod } from '../indicators/ids';
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
  source: CandleSource | null;
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
export type AssessmentFailureReason = CandleFailureReason | 'insufficient-data';

/**
 * 57-indicator vote + IDS assessment using the market-aware candle entrypoint.
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
): Promise<{ assessment: IndicatorAssessment | null; reason: AssessmentFailureReason | null; candleCount: number }> {
  try {
    if (!symbol) return { assessment: null, reason: 'unsupported-symbol', candleCount: 0 };

    // 400 calendar days normally covers SMA200; listing history can still be shorter.
    // Do not tail-align different trading calendars (crypto/Taiwan vs US sessions).
    const useSpy = candleMarket(symbol).kind === 'us';
    const [symR, spyR] = await Promise.allSettled([
      getDailyCandlesWithReason(symbol, 400),
      useSpy ? getDailyCandles('SPY', 400) : Promise.resolve(null),
    ]);

    const loaded = symR.status === 'fulfilled' ? symR.value : null;
    const raw = loaded?.candles;
    if (!raw || !Array.isArray(raw.c) || raw.c.length === 0) {
      return {
        assessment: null,
        reason: loaded?.reason ?? 'api-error',
        candleCount: 0,
      };
    }

    const candles = toCandles(raw);
    if (candles.length < 60) {
      return { assessment: null, reason: 'insufficient-data', candleCount: candles.length };
    }

    // SPY failure is non-fatal: benchmark indicators become N/A, not fabricated votes.
    const spyRaw = spyR.status === 'fulfilled' ? spyR.value : null;
    const spyCandles = spyRaw && Array.isArray(spyRaw.c) ? toCandles(spyRaw) : null;

    const { results } = computeAll(candles, spyCandles);
    // Missing volume must not become a fabricated neutral/directional vote.
    // Conservatively suppress the volume family when any retained row is incomplete.
    if (raw.volumeComplete === false || !candles.some(c => c.v > 0)) {
      for (const result of results) {
        if (result.category === 'volume') {
          result.value = null;
          result.signal = null;
          result.reason = '成交量資料缺失或全為零，量能指標不參與投票（N/A）';
        }
      }
    }
    if (!useSpy) {
      for (const result of results) {
        if (['rs20', 'beta252', 'rrg'].includes(result.id)) {
          result.reason = '此市場尚未設定比較基準（N/A）';
          if (result.id === 'rs20') result.name = 'RS（20 日相對報酬）';
        }
      }
    }
    return {
      assessment: {
        results,
        ids: computeIDS(results),
        asof: new Date(candles[candles.length - 1].t * 1000).toISOString(),
        symbol,
        source: loaded?.source ?? null,
      },
      reason: null,
      candleCount: candles.length,
    };
  } catch (e) {
    // Server action contract: never throw.
    console.error(`[indicators] unexpected error for ${symbol}:`, e);
    return { assessment: null, reason: 'api-error', candleCount: 0 };
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
 * Four-factor (T/M/V/R) + variant + IDS assessment for any supported candle market.
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
    // Shares the provider cache/in-flight request with the indicator assessment.
    const raw = await getDailyCandles(symbol, 400);
    if (!raw || !Array.isArray(raw.c) || raw.c.length < 60) return null;

    const candles = toCandles(raw);
    if (candles.length < 60) return null;

    const factors = computeFactors(candles);
    const volumeAvailable = raw.volumeComplete !== false && candles.some(c => c.v > 0);
    if (!volumeAvailable) {
      factors.V = { ...factors.V, score: null, reason: '成交量資料缺失或全為零，無法計算量能因素（N/A）' };
    }

    const variants: Record<string, VariantResult[]> = {};
    const idsPeriod: Record<string, IDSPeriodResult> = {};
    for (const id of VARIANT_INDICATORS) {
      const vs = computeVariants(candles, id);
      if (id === 'CMF' && !volumeAvailable) {
        for (const variant of vs) { variant.value = null; variant.signal = null; }
      }
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
