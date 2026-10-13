import type { FactorId } from './factors';
import { candleMarket } from '@/lib/candles/symbols';

export type FactorMarket = 'us' | 'taiwan' | 'crypto';
export type CryptoInterval = '4h' | '8h' | '12h' | '1d';
export type FactorPeriods = Record<FactorId, number>;
export interface FactorPreference {
  version: 2;
  market: FactorMarket;
  preset: 'legacy' | 'short' | 'medium' | 'long' | 'custom';
  periods: FactorPeriods;
  interval: CryptoInterval | null;
}

const FACTOR_IDS: FactorId[] = ['T', 'M', 'V', 'R'];
const INTERVALS: CryptoInterval[] = ['4h', '8h', '12h', '1d'];
const PRESET_PERIODS = {
  us: { short: 7, medium: 21, long: 126 },
  taiwan: { short: 7, medium: 21, long: 126 },
  crypto: { short: 10, medium: 30, long: 180 },
};
const TREND_PRESET_PERIODS = { short: 5, medium: 21, long: 42 } as const;

/** 週期切換只改 K 線長度，四項 N 仍代表原本的根數。 */
export function withCryptoInterval(preference: FactorPreference, interval: CryptoInterval): FactorPreference {
  return { ...preference, interval };
}

export function cryptoCoverage(n: number, interval: CryptoInterval): string {
  if (!Number.isInteger(n) || n < 1) return '—';
  const hours = n * { '4h': 4, '8h': 8, '12h': 12, '1d': 24 }[interval];
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return `約${days ? `${days}天` : ''}${remainder ? `${remainder}小時` : ''}`;
}

export function marketForSymbol(symbol: string): FactorMarket | null {
  const market = candleMarket(symbol);
  switch (market.kind) {
    case 'binance':
    case 'coingecko': return 'crypto';
    case 'taiwan': return 'taiwan';
    case 'us': return 'us';
    default: return null;
  }
}

function presetPeriods(market: FactorMarket, preset: 'legacy' | 'short' | 'medium' | 'long'): FactorPeriods {
  const n = preset === 'legacy' ? 14 : PRESET_PERIODS[market][preset];
  return { T: preset === 'legacy' ? 21 : TREND_PRESET_PERIODS[preset], M: n, V: n, R: n };
}

export function defaultFactorPreference(market: FactorMarket): FactorPreference {
  return { version: 2, market, preset: 'legacy', periods: presetPeriods(market, 'legacy'), interval: market === 'crypto' ? '1d' : null };
}

export function presetFactorPreference(
  market: FactorMarket,
  preset: 'short' | 'medium' | 'long',
  interval?: CryptoInterval,
): FactorPreference {
  return parseFactorPreference(market, {
    version: 2, market, preset, periods: presetPeriods(market, preset),
    interval: market === 'crypto' ? interval ?? '1d' : interval ?? null,
  });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/** 驗證儲存／傳入的完整偏好，並依實際四個 N 重建 preset 標籤。 */
export function parseFactorPreference(market: FactorMarket, input: unknown): FactorPreference {
  if (!isRecord(input) || input.version !== 2 || input.market !== market || !isRecord(input.periods)) {
    throw new Error('Invalid factor preference market or periods');
  }
  if (!['legacy', 'short', 'medium', 'long', 'custom'].includes(input.preset as string)) {
    throw new Error('Invalid factor preference preset');
  }
  for (const id of FACTOR_IDS) {
    const n = input.periods[id];
    const max = id === 'T' ? 50 : PRESET_PERIODS[market].long;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 5 || n > max) {
      throw new Error(`Invalid factor period ${id}: expected integer 5–${max}`);
    }
  }
  if (market === 'crypto' ? !INTERVALS.includes(input.interval as CryptoInterval) : input.interval !== null) {
    throw new Error('Invalid interval for factor preference market');
  }
  const periods: FactorPeriods = {
    T: input.periods.T as number, M: input.periods.M as number,
    V: input.periods.V as number, R: input.periods.R as number,
  };
  let preset: FactorPreference['preset'] = 'custom';
  for (const label of ['legacy', 'short', 'medium', 'long'] as const) {
    const expected = presetPeriods(market, label);
    if (FACTOR_IDS.every(id => periods[id] === expected[id])) { preset = label; break; }
  }
  return { version: 2, market, preset, periods, interval: input.interval as CryptoInterval | null };
}

/** Read-only conversion of old ADX/DMI preferences; callers must request an explicit save. */
export function migrateLegacyFactorPreference(market: FactorMarket, input: unknown): FactorPreference {
  if (!isRecord(input) || input.version !== undefined || input.market !== market || !isRecord(input.periods)) {
    throw new Error('Invalid legacy factor preference');
  }
  if (!['legacy', 'short', 'medium', 'long', 'custom'].includes(input.preset as string)) {
    throw new Error('Invalid legacy factor preset');
  }
  for (const id of FACTOR_IDS) {
    const n = input.periods[id];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 5 || n > PRESET_PERIODS[market].long) {
      throw new Error(`Invalid legacy factor period ${id}`);
    }
  }
  const trend = input.preset === 'short' ? 5 : input.preset === 'long' ? 42 : 21;
  return parseFactorPreference(market, {
    version: 2, market, preset: input.preset,
    periods: { ...input.periods, T: trend }, interval: input.interval,
  });
}
