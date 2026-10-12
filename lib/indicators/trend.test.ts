import { describe, expect, it } from 'vitest';
import { computeTrend } from './trend';
import type { Candle, IndicatorResult } from './types';

/**
 * Fake candles for a clean directional trend with mild acceleration
 * (real trends are never perfectly linear; the acceleration keeps
 * momentum-style votes like the MACD histogram unambiguous):
 * rising  → close = 300 + i + 0.001·i²
 * falling → close = 300 - i - 0.001·i²
 * （加速度取小值，保證價格全程為正，避免負價格翻轉變化率的符號）
 * Each candle has h = c + 0.5, l = c - 0.5.
 */
function makeCandles(n: number, dir: 1 | -1): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = dir === 1 ? 300 + i + 0.001 * i * i : 300 - i - 0.001 * i * i;
    out.push({
      t: i,
      o: c - 0.2,
      h: c + 0.5,
      l: c - 0.5,
      c,
      v: 1000,
    });
  }
  return out;
}

function byId(results: IndicatorResult[], id: string): IndicatorResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`missing indicator ${id}`);
  return r;
}

describe('computeTrend — rising trend (220 candles)', () => {
  const results = computeTrend(makeCandles(220, 1));

  it('returns 12 indicators, all category trend', () => {
    expect(results).toHaveLength(12);
    for (const r of results) {
      expect(r.category).toBe('trend');
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it.each([
    'ma60',
    'sma200',
    'ema1226',
    'wma20',
    'macd',
    'adx14',
    'dmi14',
    'sar',
    'ichimoku',
    'supertrend',
    'aroon25',
    'trix15',
  ])('%s votes +1 on a rising trend', (id) => {
    expect(byId(results, id).signal).toBe(1);
  });
});

describe('computeTrend — falling trend (220 candles)', () => {
  const results = computeTrend(makeCandles(220, -1));

  it.each([
    'ma60',
    'sma200',
    'ema1226',
    'wma20',
    'macd',
    'adx14',
    'dmi14',
    'sar',
    'ichimoku',
    'supertrend',
    'aroon25',
    'trix15',
  ])('%s votes -1 on a falling trend', (id) => {
    expect(byId(results, id).signal).toBe(-1);
  });
});

describe('computeTrend — insufficient data', () => {
  it('returns null value/signal when below the minimum window', () => {
    // 30 candles: below MA60/SMA200/Ichimoku/MACD/TRIX minimums
    const results = computeTrend(makeCandles(30, 1));
    const ma = byId(results, 'ma60');
    expect(ma.value).toBeNull();
    expect(ma.signal).toBeNull();
    expect(byId(results, 'sma200').signal).toBeNull();
    expect(byId(results, 'ichimoku').signal).toBeNull();
    expect(byId(results, 'macd').signal).toBeNull();
    expect(byId(results, 'trix15').signal).toBeNull();
  });

  it('computes exactly at the minimum window boundary', () => {
    // MA60 needs exactly 60 candles; ADX needs 28
    const r60 = computeTrend(makeCandles(60, 1));
    expect(byId(r60, 'ma60').signal).toBe(1);
    expect(byId(r60, 'sma200').signal).toBeNull();
  });

  it('DMI is computable before ADX is ready (15–27 candles)', () => {
    // DMI needs only the first Wilder-smoothed ±DI (15 candles);
    // ADX needs a full DX period on top (28 candles).
    const r20 = computeTrend(makeCandles(20, 1));
    expect(byId(r20, 'dmi14').signal).toBe(1);
    expect(byId(r20, 'dmi14').value).not.toBeNull();
    expect(byId(r20, 'adx14').signal).toBeNull();
  });
});
