import { describe, expect, it } from 'vitest';
import { computeMomentum } from './momentum';
import type { Candle, IndicatorResult } from './types';

/**
 * Fake candles for a clean accelerated trend
 * (same shape as the trend-task fixture, steeper slope so the
 *  20-day BIAS cleanly crosses the ±5% voting line):
 * rising  → close = 300 + 2.5·i + 0.002·i²
 * falling → close = 300 − 2.5·i − 0.002·i²
 * （基底 300 保證下跌夾具全程價格為正；微加速度讓 KD/KDJ 的 K−D 有嚴格符號）
 * Each candle has h = c + 0.5, l = c − 0.5.
 */
function makeTrend(n: number, dir: 1 | -1): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c =
      dir === 1 ? 300 + 2.5 * i + 0.002 * i * i : 300 - 2.5 * i - 0.002 * i * i;
    out.push({ t: i, o: c - 0.2, h: c + 0.5, l: c - 0.5, c, v: 1000 });
  }
  return out;
}

/**
 * Ultimate Oscillator needs real buying-pressure variance, which the
 * symmetric h/l fixture cannot produce (BP/TR is always 50 there).
 * Overbought: 22 flat candles at 100, then 7 candles each gapping
 * +8 with tight ranges (buying pressure ≈ 97.6 per window).
 * Oversold: mirror image (−8 per candle, buying pressure ≈ 2.4).
 */
function makeSpike(dir: 1 | -1): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 22; i++) {
    out.push({ t: i, o: 100, h: 100.3, l: 99.7, c: 100, v: 1000 });
  }
  for (let k = 1; k <= 7; k++) {
    const c = 100 + dir * 8 * k;
    out.push({
      t: 21 + k,
      o: c - dir * 7.9,
      h: c + 0.2,
      l: c - 0.2,
      c,
      v: 1000,
    });
  }
  return out;
}

/**
 * PPO (unlike MACD) normalizes the EMA spread by price level, so on a
 * steady linear rise the percentage spread shrinks and the histogram
 * reads slightly negative — the mechanically correct vote there is −1.
 * A clean ±1 needs late acceleration: `base` flat candles at 300, then
 * `move` candles each moving ±5 (momentum re-accelerates → histogram
 * takes the move's sign).
 */
function makeLateMove(dir: 1 | -1, base: number, move: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < base; i++) {
    out.push({ t: i, o: 300, h: 300.5, l: 299.5, c: 300, v: 1000 });
  }
  for (let k = 1; k <= move; k++) {
    const c = 300 + dir * 5 * k;
    out.push({
      t: base - 1 + k,
      o: c - dir * 4.8,
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

describe('computeMomentum — structure', () => {
  const results = computeMomentum(makeTrend(60, 1));

  it('returns 12 indicators, all category momentum', () => {
    expect(results).toHaveLength(12);
    for (const r of results) {
      expect(r.category).toBe('momentum');
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('covers the 12 specified indicator ids', () => {
    const ids = results.map((r) => r.id);
    expect(ids).toEqual([
      'rsi14',
      'kd933',
      'kdj',
      'cci20',
      'roc12',
      'mom10',
      'willr14',
      'tsi2513',
      'ppo12269',
      'bias20',
      'dpo20',
      'uo71428',
    ]);
  });
});

describe('computeMomentum — rising trend (60 candles)', () => {
  const results = computeMomentum(makeTrend(60, 1));

  // 規則機械套用：超買類（RSI/CCI/WilliamsR/BIAS/UO）在上漲趨勢中投 −1；
  // 方向類（ROC/MOM/TSI/KD/KDJ）投 +1；
  // DPO 取 11 根前收盤 − SMA20，在上漲趨勢中為負 → −1；
  // PPO 因以價格標準化，穩定上漲中柱值為負，方向由專屬 makeLateMove 夾具驗證。
  it.each([
    ['rsi14', -1],
    ['kd933', 1],
    ['kdj', 1],
    ['cci20', -1],
    ['roc12', 1],
    ['mom10', 1],
    ['willr14', -1],
    ['tsi2513', 1],
    ['bias20', -1],
    ['dpo20', -1],
    ['uo71428', -1],
  ] as const)('%s votes %i on a rising trend', (id, expected) => {
    expect(byId(results, id).signal).toBe(expected);
  });
});

describe('computeMomentum — falling trend (60 candles)', () => {
  const results = computeMomentum(makeTrend(60, -1));

  it.each([
    ['rsi14', 1],
    ['kd933', -1],
    ['kdj', -1],
    ['cci20', 1],
    ['roc12', -1],
    ['mom10', -1],
    ['willr14', 1],
    ['tsi2513', -1],
    ['bias20', 1],
    ['dpo20', 1],
    ['uo71428', 1],
  ] as const)('%s votes %i on a falling trend', (id, expected) => {
    expect(byId(results, id).signal).toBe(expected);
  });
});

describe('computeMomentum — PPO late-acceleration fixtures', () => {
  it('votes +1 after a late rally (histogram > 0)', () => {
    // 27 平盤 + 7 急拉 = 34 根，恰為 PPO 最小窗口
    const r = byId(computeMomentum(makeLateMove(1, 27, 7)), 'ppo12269');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeGreaterThan(0);
    expect(r.signal).toBe(1);
  });

  it('votes -1 after a late selloff (histogram < 0)', () => {
    const r = byId(computeMomentum(makeLateMove(-1, 27, 7)), 'ppo12269');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeLessThan(0);
    expect(r.signal).toBe(-1);
  });

  it('is null one candle below the minimum window', () => {
    expect(byId(computeMomentum(makeLateMove(1, 26, 7)), 'ppo12269').signal).toBeNull();
  });
});

describe('computeMomentum — Ultimate Oscillator spike fixtures (29 candles)', () => {
  it('votes -1 on the overbought spike (UO > 70)', () => {
    const r = byId(computeMomentum(makeSpike(1)), 'uo71428');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeGreaterThan(70);
    expect(r.signal).toBe(-1);
  });

  it('votes +1 on the oversold spike (UO < 30)', () => {
    const r = byId(computeMomentum(makeSpike(-1)), 'uo71428');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeLessThan(30);
    expect(r.signal).toBe(1);
  });
});

describe('computeMomentum — insufficient data', () => {
  it('returns null value/signal when below the minimum window', () => {
    // 20 candles: below TSI(38)/PPO(34)/UO(29) minimums
    const results = computeMomentum(makeTrend(20, 1));
    expect(byId(results, 'tsi2513').signal).toBeNull();
    expect(byId(results, 'tsi2513').value).toBeNull();
    expect(byId(results, 'ppo12269').signal).toBeNull();
    expect(byId(results, 'uo71428').signal).toBeNull();
    // …but the short-window indicators already compute
    expect(byId(results, 'rsi14').signal).toBe(-1);
    expect(byId(results, 'mom10').signal).toBe(1);
    expect(byId(results, 'roc12').signal).toBe(1);
  });

  it('computes exactly at the minimum window boundaries', () => {
    // TSI needs 38 candles
    expect(byId(computeMomentum(makeTrend(38, 1)), 'tsi2513').signal).toBe(1);
    expect(byId(computeMomentum(makeTrend(37, 1)), 'tsi2513').signal).toBeNull();
    // UO needs 29 candles (spike fixture is exactly 29)
    expect(byId(computeMomentum(makeSpike(1)), 'uo71428').signal).toBe(-1);
  });

  it('never returns NaN', () => {
    for (const n of [1, 5, 13, 29, 60]) {
      for (const r of computeMomentum(makeTrend(n, 1))) {
        if (r.value !== null) expect(Number.isNaN(r.value)).toBe(false);
      }
    }
  });
});
