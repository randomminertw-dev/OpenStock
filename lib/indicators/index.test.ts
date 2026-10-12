import { describe, expect, it } from 'vitest';
import { computeAll } from './index';
import type { Candle, IndicatorResult } from './types';

/**
 * Fake candles: 300 days of mild accelerating uptrend with realistic
 * o/h/l/v. SMA200 needs 250+ trading days, so 300 guarantees full coverage.
 */
function makeCandles(n: number, dir: 1 | -1): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = dir === 1 ? 300 + i + 0.001 * i * i : 300 - i - 0.001 * i * i;
    out.push({ t: i, o: c - 0.2, h: c + 0.5, l: c - 0.5, c, v: 1000 + i * 3 });
  }
  return out;
}

const EXPECTED_BY_CATEGORY: Record<string, number> = {
  trend: 12,
  momentum: 12,
  volatility: 9,
  volume: 10,
  support: 7,
  breadth: 7,
};

describe('computeAll', () => {
  it('returns exactly 57 indicator results with the expected per-category split', () => {
    const candles = makeCandles(300, 1);
    const spyCandles = makeCandles(300, 1);
    const { results, ids } = computeAll(candles, spyCandles);
    expect(results.length).toBe(57);
    for (const [category, expected] of Object.entries(EXPECTED_BY_CATEGORY)) {
      const count = results.filter((r) => r.category === category).length;
      expect(count, `category ${category}`).toBe(expected);
    }
    expect(ids).not.toBeNull();
  });

  it('still returns 57 results when SPY candles are null (breadth falls back)', () => {
    const candles = makeCandles(300, 1);
    const { results, ids } = computeAll(candles, null);
    expect(results.length).toBe(57);
    expect(ids).not.toBeNull();
  });

  it('passes signal=null ("not computable") results through without filtering', () => {
    // Fractals semantic: value=null, signal=0 means "confirmed neutral" (counts in W0);
    // signal=null means "not computable". Neither may be filtered out.
    const candles = makeCandles(300, 1);
    const { results } = computeAll(candles, null);
    const notComputable = results.filter((r) => r.signal === null);
    const total = EXPECTED_BY_CATEGORY.trend + EXPECTED_BY_CATEGORY.momentum +
      EXPECTED_BY_CATEGORY.volatility + EXPECTED_BY_CATEGORY.volume +
      EXPECTED_BY_CATEGORY.support + EXPECTED_BY_CATEGORY.breadth;
    expect(results.length).toBe(total);
    // with 300 candles + null SPY, breadth must emit some not-computable results
    expect(notComputable.length).toBeGreaterThan(0);
  });

  it('returns non-null ids fields (aggregates over all 57 votes)', () => {
    const candles = makeCandles(300, 1);
    const spyCandles = makeCandles(300, -1);
    const { ids } = computeAll(candles, spyCandles);
    for (const key of [
      'upPct', 'downPct', 'neutralPct', 'idsPct', 'consensusPct', 'coveragePct', 'entropyPct',
    ] as const) {
      expect(ids[key], key).not.toBeNull();
    }
    expect(['bullish', 'bearish', 'neutral']).toContain(ids.direction);
  });
});
