import type { FactorId } from './factors';

export type FactorMarket = 'us' | 'taiwan' | 'crypto';
export type CryptoInterval = '4h' | '8h' | '12h' | '1d';
export type FactorPeriods = Record<FactorId, number>;
export interface FactorPreference {
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

export function marketForSymbol(symbol: string): FactorMarket | null {
  const normalized = symbol.trim().toUpperCase();
  if (/^(BINANCE|CG):.+$/.test(normalized)) return 'crypto';
  if (/^\d+\.TW$/.test(normalized)) return 'taiwan';
  if (/^[A-Z]+(?:[.-][A-Z])?$/.test(normalized)) return 'us';
  return null;
}

function uniformPeriods(n: number): FactorPeriods {
  return { T: n, M: n, V: n, R: n };
}

export function defaultFactorPreference(market: FactorMarket): FactorPreference {
  return { market, preset: 'legacy', periods: uniformPeriods(14), interval: market === 'crypto' ? '1d' : null };
}

export function presetFactorPreference(
  market: FactorMarket,
  preset: 'short' | 'medium' | 'long',
  interval?: CryptoInterval,
): FactorPreference {
  return parseFactorPreference(market, {
    market, preset, periods: uniformPeriods(PRESET_PERIODS[market][preset]),
    interval: market === 'crypto' ? interval ?? '1d' : interval ?? null,
  });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/** 驗證儲存／傳入的完整偏好，並依實際四個 N 重建 preset 標籤。 */
export function parseFactorPreference(market: FactorMarket, input: unknown): FactorPreference {
  if (!isRecord(input) || input.market !== market || !isRecord(input.periods)) {
    throw new Error('Invalid factor preference market or periods');
  }
  if (!['legacy', 'short', 'medium', 'long', 'custom'].includes(input.preset as string)) {
    throw new Error('Invalid factor preference preset');
  }
  const max = PRESET_PERIODS[market].long;
  for (const id of FACTOR_IDS) {
    const n = input.periods[id];
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
    const n = label === 'legacy' ? 14 : PRESET_PERIODS[market][label];
    if (FACTOR_IDS.every(id => periods[id] === n)) { preset = label; break; }
  }
  return { market, preset, periods, interval: input.interval as CryptoInterval | null };
}
