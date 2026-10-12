import { describe, expect, it } from 'vitest';
import { computeSupport } from './support';
import type { Candle, IndicatorResult } from './types';

/**
 * 上升／下跌趨勢夾具（與 volume 測試同形狀）：
 * rising  → close = 300 + 2.5·i + 0.002·i²
 * falling → close = 300 − 2.5·i − 0.002·i²
 * 每根 h = c + 0.5，l = c − 0.5，v = 1000。
 * 單調趨勢 → 不會形成確認分形（Fractals 預期 0）。
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

/** 完全平盤夾具（測試除零／退化保護：不得出現 NaN）。 */
function makeFlat(n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: i, o: 100, h: 100, l: 100, c: 100, v: 1000 });
  }
  return out;
}

/**
 * Fibonacci 夾具：60 根；第 0 根定出 60 日高低（h = 120, l = 80），
 * 其餘收在 95 附近。61.8% 回撤位 = 120 − 0.618 × 40 = 95.28。
 * closeMode: 'above' → 最後收 96（> 95.28 → +1）；
 *            'below' → 最後收 95（< 95.28 → −1）；
 *            'equal' → 最後收 95.28（= 回撤位 → 0）。
 */
function makeFib(closeMode: 'above' | 'below' | 'equal'): Candle[] {
  const out: Candle[] = [];
  out.push({ t: 0, o: 100, h: 120, l: 80, c: 100, v: 1000 });
  for (let i = 1; i < 59; i++) {
    out.push({ t: i, o: 95, h: 100, l: 90, c: 95, v: 1000 });
  }
  // 以相同運算式取回撤位，確保「恰相等」測試不受浮點末位差影響
  const level = 120 - 0.618 * 40;
  const c = closeMode === 'above' ? 96 : closeMode === 'below' ? 95 : level;
  out.push({ t: 59, o: 95, h: 96, l: 94, c, v: 1000 });
  return out;
}

/** 前日 K 線（Pivot／CPR／Camarilla 計算基準）: P = 105, BC = 105, TC = 105。 */
const PREV_FLATISH: Candle = { t: 0, o: 104, h: 111, l: 99, c: 105, v: 1000 };

/**
 * 前日 K 線（CPR 區間測試）: h = 112, l = 88, c = 104 →
 * P = 101.333…, BC = 100, TC = 102.666…（真實區間）。
 */
const PREV_CPR: Candle = { t: 0, o: 100, h: 112, l: 88, c: 104, v: 1000 };

/** 前日 K 線（Camarilla 測試）: h = 110, l = 90, c = 100 → R4 = 111, S4 = 89。 */
const PREV_CAM: Candle = { t: 0, o: 100, h: 110, l: 90, c: 100, v: 1000 };

function makeLast(close: number): Candle {
  return { t: 1, o: close - 0.2, h: close + 0.5, l: close - 0.5, c: close, v: 1000 };
}

/**
 * 分形夾具（7 根）: type = 'top' → 第 3 根 h = 110（頂分形，已確認）；
 * type = 'bottom' → 第 3 根 l = 90（底分形，已確認）；
 * type = 'unconfirmed' → 峰值在最後一根（i = 6，右側不足 2 根，未確認）；
 * type = 'none' → 全部平坦，無分形。
 */
function makeFractal(type: 'top' | 'bottom' | 'unconfirmed' | 'none'): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 7; i++) {
    let h = 100;
    let l = 99;
    if (type === 'top' && i === 3) h = 110;
    if (type === 'bottom' && i === 3) l = 90;
    if (type === 'unconfirmed' && i === 6) h = 110;
    out.push({ t: i, o: 99.5, h, l, c: 99.5, v: 1000 });
  }
  return out;
}

/**
 * 分形夾具（9 根，頂＋底並存）: i = 2 為頂分形（h = 115），
 * i = 4 為底分形（l = 85）→ 最近確認的是底分形，預期 +1。
 */
function makeFractalBoth(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 9; i++) {
    const h = i === 2 ? 115 : 100;
    const l = i === 4 ? 85 : 99;
    out.push({ t: i, o: 99.5, h, l, c: 99.5, v: 1000 });
  }
  return out;
}

/**
 * 通道中性夾具：55 根；前 54 根 h = 101, l = 99, c = 100；
 * 最後一根 c = 100 → 通道位置 = 50% → 0。
 */
function makeChannelMid(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 54; i++) {
    out.push({ t: i, o: 100, h: 101, l: 99, c: 100, v: 1000 });
  }
  out.push({ t: 54, o: 100, h: 101, l: 99, c: 100, v: 1000 });
  return out;
}

function byId(results: IndicatorResult[], id: string): IndicatorResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`missing indicator ${id}`);
  return r;
}

describe('computeSupport — structure', () => {
  const results = computeSupport(makeTrend(70, 1));

  it('returns 7 indicators, all category support', () => {
    expect(results).toHaveLength(7);
    for (const r of results) {
      expect(r.category).toBe('support');
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('covers the 7 specified indicator ids in order', () => {
    const ids = results.map((r) => r.id);
    expect(ids).toEqual([
      'fib60',
      'pivot',
      'cpr',
      'pricechannel55',
      'maenvelope20',
      'camarilla',
      'fractals',
    ]);
  });

  it('never returns NaN or Infinity', () => {
    for (const r of results) {
      if (r.value !== null) {
        expect(Number.isFinite(r.value)).toBe(true);
      }
      expect([1, 0, -1, null]).toContain(r.signal);
    }
  });

  it('flat 70-bar fixture produces no NaN', () => {
    const flat = computeSupport(makeFlat(70));
    for (const r of flat) {
      if (r.value !== null) expect(Number.isFinite(r.value)).toBe(true);
      expect([1, 0, -1, null]).toContain(r.signal);
    }
    // 退化約定：收盤恰在位階上 → 中性 0（Fibonacci／Pivot／MAEnvelope／Camarilla）
    expect(byId(flat, 'fib60').signal).toBe(0);
    expect(byId(flat, 'pivot').signal).toBe(0);
    expect(byId(flat, 'cpr').signal).toBe(0); // TC = BC = 100，收盤 100 在區間內
    expect(byId(flat, 'maenvelope20').signal).toBe(0);
    expect(byId(flat, 'camarilla').signal).toBe(0);
    expect(byId(flat, 'fractals').signal).toBe(0);
    // 55 日完全無波動 → 通道位置無法定義 → null
    const pc = byId(flat, 'pricechannel55');
    expect(pc.value).toBeNull();
    expect(pc.signal).toBeNull();
  });
});

describe('computeSupport — insufficient data', () => {
  it('empty input → all null', () => {
    const results = computeSupport([]);
    expect(results).toHaveLength(7);
    for (const r of results) {
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
    }
  });

  it('4 bars → fib60 / pricechannel55 / maenvelope20 / fractals null; pivot / cpr / camarilla computable', () => {
    const results = computeSupport(makeTrend(4, 1));
    for (const id of ['fib60', 'pricechannel55', 'maenvelope20', 'fractals']) {
      const r = byId(results, id);
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
    }
    for (const id of ['pivot', 'cpr', 'camarilla']) {
      const r = byId(results, id);
      expect(r.value).not.toBeNull();
      expect(r.signal).not.toBeNull();
    }
  });
});

describe('Fibonacci（60 日高低 61.8%）', () => {
  it('close above 61.8% level → +1', () => {
    const r = byId(computeSupport(makeFib('above')), 'fib60');
    expect(r.signal).toBe(1);
    expect(r.value).toBeCloseTo(95.28, 10);
  });

  it('close below 61.8% level → −1', () => {
    const r = byId(computeSupport(makeFib('below')), 'fib60');
    expect(r.signal).toBe(-1);
  });

  it('close exactly on the level → 0', () => {
    const r = byId(computeSupport(makeFib('equal')), 'fib60');
    expect(r.signal).toBe(0);
  });

  it('rising trend → close above retracement → +1; falling → −1', () => {
    expect(byId(computeSupport(makeTrend(60, 1)), 'fib60').signal).toBe(1);
    expect(byId(computeSupport(makeTrend(60, -1)), 'fib60').signal).toBe(-1);
  });
});

describe('Pivot（前日 HLC/3）', () => {
  it('close above pivot → +1, value = (H+L+C)/3 of previous day', () => {
    const r = byId(computeSupport([PREV_FLATISH, makeLast(106)]), 'pivot');
    expect(r.value).toBeCloseTo(105, 10); // (111+99+105)/3 = 105
    expect(r.signal).toBe(1);
  });

  it('close below pivot → −1', () => {
    const r = byId(computeSupport([PREV_FLATISH, makeLast(104)]), 'pivot');
    expect(r.signal).toBe(-1);
  });

  it('close equal to pivot → 0', () => {
    const r = byId(computeSupport([PREV_FLATISH, makeLast(105)]), 'pivot');
    expect(r.signal).toBe(0);
  });

  it('rising trend → +1; falling trend → −1', () => {
    expect(byId(computeSupport(makeTrend(30, 1)), 'pivot').signal).toBe(1);
    expect(byId(computeSupport(makeTrend(30, -1)), 'pivot').signal).toBe(-1);
  });
});

describe('CPR（前日中央樞紐區）', () => {
  it('close above TC → +1（上緣 = 102.666…）', () => {
    const r = byId(computeSupport([PREV_CPR, makeLast(103)]), 'cpr');
    expect(r.value).toBeCloseTo(102.6666667, 6); // TC = 2P − BC
    expect(r.signal).toBe(1);
  });

  it('close below BC → −1', () => {
    const r = byId(computeSupport([PREV_CPR, makeLast(99)]), 'cpr');
    expect(r.signal).toBe(-1);
  });

  it('close inside the range → 0', () => {
    const r = byId(computeSupport([PREV_CPR, makeLast(101.5)]), 'cpr');
    expect(r.signal).toBe(0);
  });

  it('close exactly on an edge → 0', () => {
    const r = byId(computeSupport([PREV_CPR, makeLast(100)]), 'cpr'); // = BC
    expect(r.signal).toBe(0);
  });
});

describe('PriceChannel（55 日）', () => {
  it('position > 75% → −1（接近上緣壓力）', () => {
    const r = byId(computeSupport(makeTrend(60, 1)), 'pricechannel55');
    expect(r.value).toBeGreaterThan(75);
    expect(r.signal).toBe(-1);
  });

  it('position < 25% → +1', () => {
    const r = byId(computeSupport(makeTrend(60, -1)), 'pricechannel55');
    expect(r.value).toBeLessThan(25);
    expect(r.signal).toBe(1);
  });

  it('position = 50% → 0', () => {
    const r = byId(computeSupport(makeChannelMid()), 'pricechannel55');
    expect(r.value).toBeCloseTo(50, 10);
    expect(r.signal).toBe(0);
  });
});

describe('MAEnvelope（SMA20＋2.5%）', () => {
  it('close above upper band → −1, value = upper band price', () => {
    const candles = makeTrend(30, 1);
    const r = byId(computeSupport(candles), 'maenvelope20');
    const closes = candles.map((c) => c.c);
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    expect(r.value).toBeCloseTo(sma20 * 1.025, 8);
    expect(r.signal).toBe(-1);
  });

  it('close below lower band → +1', () => {
    const r = byId(computeSupport(makeTrend(30, -1)), 'maenvelope20');
    expect(r.signal).toBe(1);
  });

  it('close inside the envelope → 0', () => {
    const r = byId(computeSupport(makeFlat(30)), 'maenvelope20');
    expect(r.signal).toBe(0);
  });
});

describe('Camarilla（前日 R4）', () => {
  it('close above R4 → −1（過熱）, value = R4 = 111', () => {
    const r = byId(computeSupport([PREV_CAM, makeLast(112)]), 'camarilla');
    expect(r.value).toBeCloseTo(111, 10); // 100 + 20 × 1.1/2
    expect(r.signal).toBe(-1);
  });

  it('close below S4 → +1', () => {
    const r = byId(computeSupport([PREV_CAM, makeLast(88)]), 'camarilla');
    expect(r.signal).toBe(1);
  });

  it('close between S4 and R4 → 0', () => {
    const r = byId(computeSupport([PREV_CAM, makeLast(100)]), 'camarilla');
    expect(r.signal).toBe(0);
  });
});

describe('Fractals', () => {
  it('most recent confirmed fractal is a top → −1, value = fractal high', () => {
    const r = byId(computeSupport(makeFractal('top')), 'fractals');
    expect(r.value).toBe(110);
    expect(r.signal).toBe(-1);
  });

  it('most recent confirmed fractal is a bottom → +1, value = fractal low', () => {
    const r = byId(computeSupport(makeFractal('bottom')), 'fractals');
    expect(r.value).toBe(90);
    expect(r.signal).toBe(1);
  });

  it('peak on the last bar is NOT confirmed (2-bar right-side delay) → 0', () => {
    const r = byId(computeSupport(makeFractal('unconfirmed')), 'fractals');
    expect(r.value).toBeNull();
    expect(r.signal).toBe(0);
  });

  it('no fractal at all → 0 with null value', () => {
    const r = byId(computeSupport(makeFractal('none')), 'fractals');
    expect(r.value).toBeNull();
    expect(r.signal).toBe(0);
  });

  it('when both exist, the most recent confirmed fractal wins', () => {
    const r = byId(computeSupport(makeFractalBoth()), 'fractals');
    expect(r.value).toBe(85);
    expect(r.signal).toBe(1);
  });

  it('monotonic trend → no confirmed fractal → 0', () => {
    expect(byId(computeSupport(makeTrend(30, 1)), 'fractals').signal).toBe(0);
    expect(byId(computeSupport(makeTrend(30, -1)), 'fractals').signal).toBe(0);
  });

  it('exactly 5 bars can confirm the middle bar', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 5; i++) {
      candles.push({
        t: i,
        o: 99.5,
        h: i === 2 ? 110 : 100,
        l: 99,
        c: 99.5,
        v: 1000,
      });
    }
    const r = byId(computeSupport(candles), 'fractals');
    expect(r.value).toBe(110);
    expect(r.signal).toBe(-1);
  });
});
