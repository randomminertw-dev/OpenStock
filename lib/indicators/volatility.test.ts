import { describe, expect, it } from 'vitest';
import { computeVolatility } from './volatility';
import type { Candle, IndicatorResult } from './types';

/**
 * 上升／下跌趨勢夾具（與 momentum 測試同形狀）：
 * rising  → close = 300 + 2.5·i + 0.002·i²
 * falling → close = 300 − 2.5·i − 0.002·i²
 * 每根 h = c + 0.5，l = c − 0.5。
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
 * 布林帶突破夾具：19 根平盤（c = 100，h/l ±0.3）後，
 * 最後一根收在 100 ± 50，必定穿破上下軌。
 * dir = 1 → 向上突破上軌 → 訊號 −1；dir = −1 → 向下跌破下軌 → +1。
 */
function makeBreak(dir: 1 | -1): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 19; i++) {
    out.push({ t: i, o: 100, h: 100.3, l: 99.7, c: 100, v: 1000 });
  }
  const c = 100 + dir * 50;
  out.push({ t: 19, o: 100, h: c + 0.3, l: c - 0.3, c, v: 1000 });
  return out;
}

/** 完全平盤夾具（測試除零／退化保護：不得出現 NaN）。 */
function makeFlat(n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: i, o: 100, h: 100, l: 100, c: 100, v: 1000 });
  }
  return out;
}

function byId(results: IndicatorResult[], id: string): IndicatorResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`missing indicator ${id}`);
  return r;
}

describe('computeVolatility — structure', () => {
  const results = computeVolatility(makeTrend(30, 1));

  it('returns 9 indicators, all category volatility', () => {
    expect(results).toHaveLength(9);
    for (const r of results) {
      expect(r.category).toBe('volatility');
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('covers the 9 specified indicator ids', () => {
    const ids = results.map((r) => r.id);
    expect(ids).toEqual([
      'bb202',
      'atr14',
      'keltner2010',
      'donchian20',
      'hv20',
      'stdev20',
      'bbw',
      'choppiness14',
      'natr14',
    ]);
  });

  it('never returns NaN or Infinity (flat-line fixture included)', () => {
    for (const fixture of [makeTrend(30, 1), makeFlat(30)]) {
      for (const r of computeVolatility(fixture)) {
        if (r.value !== null) expect(Number.isFinite(r.value)).toBe(true);
        if (r.signal !== null) expect([-1, 0, 1]).toContain(r.signal);
      }
    }
  });
});

describe('computeVolatility — Bollinger band-break direction (20 candles)', () => {
  it('votes +1 when close breaks below the lower band (超賣反彈)', () => {
    const r = byId(computeVolatility(makeBreak(-1)), 'bb202');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeLessThan(0); // %B < 0 → 跌破下軌
    expect(r.signal).toBe(1);
  });

  it('votes -1 when close breaks above the upper band（過熱）', () => {
    const r = byId(computeVolatility(makeBreak(1)), 'bb202');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeGreaterThan(100); // %B > 100 → 突破上軌
    expect(r.signal).toBe(-1);
  });

  it('votes 0 when close stays inside the bands', () => {
    const r = byId(computeVolatility(makeTrend(30, 1)), 'bb202');
    expect(r.value).not.toBeNull();
    expect(r.signal).toBe(0);
  });
});

describe('computeVolatility — Keltner band-break direction (20 candles)', () => {
  it('votes +1 when close breaks below the lower band', () => {
    expect(byId(computeVolatility(makeBreak(-1)), 'keltner2010').signal).toBe(1);
  });

  it('votes -1 when close breaks above the upper band', () => {
    expect(byId(computeVolatility(makeBreak(1)), 'keltner2010').signal).toBe(-1);
  });
});

describe('computeVolatility — Donchian channel position (20 candles)', () => {
  it('votes -1 when close sits in the top 25% of the channel（過熱）', () => {
    const r = byId(computeVolatility(makeTrend(20, 1)), 'donchian20');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeGreaterThan(75);
    expect(r.signal).toBe(-1);
  });

  it('votes +1 when close sits in the bottom 25% of the channel', () => {
    const r = byId(computeVolatility(makeTrend(20, -1)), 'donchian20');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeLessThan(25);
    expect(r.signal).toBe(1);
  });

  it('votes 0 in a flat channel (degenerate, no NaN)', () => {
    const r = byId(computeVolatility(makeFlat(20)), 'donchian20');
    expect(r.signal).toBe(0);
  });
});

describe('computeVolatility — Choppiness Index (14)', () => {
  it('votes +1 when CHOP < 38.2 and the window trend is up', () => {
    const r = byId(computeVolatility(makeTrend(20, 1)), 'choppiness14');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeLessThan(38.2);
    expect(r.signal).toBe(1);
  });

  it('votes -1 when CHOP < 38.2 and the window trend is down', () => {
    const r = byId(computeVolatility(makeTrend(20, -1)), 'choppiness14');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeLessThan(38.2);
    expect(r.signal).toBe(-1);
  });
});

describe('computeVolatility — pure volatility measures always vote 0', () => {
  const results = computeVolatility(makeTrend(30, 1));

  it.each(['atr14', 'hv20', 'stdev20', 'bbw', 'natr14'] as const)(
    '%s computes a finite value but its signal is always 0',
    (id) => {
      const r = byId(results, id);
      expect(r.value).not.toBeNull();
      expect(Number.isFinite(r.value as number)).toBe(true);
      expect((r.value as number)).toBeGreaterThanOrEqual(0);
      expect(r.signal).toBe(0);
    },
  );
});

describe('computeVolatility — insufficient data', () => {
  it('returns null value/signal one candle below each minimum window', () => {
    // BB/Keltner/Donchian/HV/StdDev/BBW need ≥ 20（或 21）根
    const r19 = computeVolatility(makeTrend(19, 1));
    for (const id of ['bb202', 'keltner2010', 'donchian20', 'hv20', 'stdev20', 'bbw']) {
      const r = byId(r19, id);
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
    }
    // ATR/NATR need ≥ 15 根；Choppiness need ≥ 15 根
    const r14 = computeVolatility(makeTrend(14, 1));
    for (const id of ['atr14', 'natr14', 'choppiness14']) {
      const r = byId(r14, id);
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
    }
  });

  it('computes normally exactly at the minimum window', () => {
    const r20 = computeVolatility(makeTrend(20, 1));
    expect(byId(r20, 'bb202').signal).not.toBeNull();
    expect(byId(r20, 'donchian20').signal).not.toBeNull();
    const r21 = computeVolatility(makeTrend(21, 1));
    expect(byId(r21, 'hv20').signal).not.toBeNull();
    const r15 = computeVolatility(makeTrend(15, 1));
    expect(byId(r15, 'atr14').signal).not.toBeNull();
    expect(byId(r15, 'natr14').signal).not.toBeNull();
    expect(byId(r15, 'choppiness14').signal).not.toBeNull();
  });
});
