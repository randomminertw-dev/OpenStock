import { describe, expect, it } from 'vitest';
import { computeBreadth } from './breadth';
import type { Candle, IndicatorResult } from './types';

/** 由收盤序列建出簡易 K 線（o/h/l 取收盤價，v 固定）。 */
function mkCandles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1000 }));
}

/** 由日報酬序列建出價格序列（起價 100）。 */
function fromReturns(rets: number[]): number[] {
  const out = [100];
  for (const r of rets) out.push(out[out.length - 1] * (1 + r));
  return out;
}

/** 依 id 取出單一指標結果，缺失則拋錯。 */
function get(results: IndicatorResult[], id: string): IndicatorResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`missing indicator ${id}`);
  return r;
}

/** 252 日市場日報酬夾具：交替正負，確保變異數 > 0。 */
function marketRets(n: number): number[] {
  const pattern = [0.012, -0.008, 0.02, -0.015, 0.006];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(pattern[i % pattern.length]);
  return out;
}

describe('computeBreadth', () => {
  it('回傳 7 項，category 皆為 breadth', () => {
    const stock = mkCandles(Array.from({ length: 300 }, (_, i) => 100 + i));
    const spy = mkCandles(Array.from({ length: 300 }, (_, i) => 200 + i * 0.5));
    const res = computeBreadth(stock, spy);
    expect(res).toHaveLength(7);
    expect(res.map((r) => r.id)).toEqual([
      'adline',
      'trin',
      'mcclellan',
      'newhighlow',
      'rs20',
      'beta252',
      'rrg',
    ]);
    for (const r of res) expect(r.category).toBe('breadth');
  });

  it('4 項 N/A（ADLine / TRIN / McClellan / NewHighLow）恆為 null', () => {
    const stock = mkCandles(Array.from({ length: 300 }, (_, i) => 100 + i));
    const spy = mkCandles(Array.from({ length: 300 }, (_, i) => 200 + i * 0.5));
    const res = computeBreadth(stock, spy);
    for (const id of ['adline', 'trin', 'mcclellan', 'newhighlow']) {
      const r = get(res, id);
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('spyCandles=null 時 RS / Beta / RRG 皆 null', () => {
    const stock = mkCandles(Array.from({ length: 300 }, (_, i) => 100 + i));
    const res = computeBreadth(stock, null);
    for (const id of ['rs20', 'beta252', 'rrg']) {
      const r = get(res, id);
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
    }
    // 4 項 N/A 在 spy 為 null 時仍為 null
    for (const id of ['adline', 'trin', 'mcclellan', 'newhighlow']) {
      expect(get(res, id).signal).toBeNull();
    }
  });

  describe('RS（20 日個股報酬 − SPY 報酬）', () => {
    it('個股跑贏大盤 → +1', () => {
      // 個股每日 +1%，SPY 平盤，20 日報酬差 ≈ 1.01^20 − 1
      const stock = mkCandles(fromReturns(new Array(20).fill(0.01)));
      const spy = mkCandles(new Array(21).fill(200));
      const r = get(computeBreadth(stock, spy), 'rs20');
      expect(r.signal).toBe(1);
      expect(r.value).toBeCloseTo(Math.pow(1.01, 20) - 1, 6);
    });

    it('個股跑輸大盤 → −1', () => {
      const stock = mkCandles(new Array(21).fill(100));
      const spy = mkCandles(fromReturns(new Array(20).fill(0.01)));
      const r = get(computeBreadth(stock, spy), 'rs20');
      expect(r.signal).toBe(-1);
      expect(r.value).toBeCloseTo(-(Math.pow(1.01, 20) - 1), 6);
    });

    it('報酬相等 → 0', () => {
      const closes = fromReturns(new Array(20).fill(0.01));
      const r = get(
        computeBreadth(mkCandles(closes), mkCandles(closes.slice())),
        'rs20',
      );
      expect(r.value).toBe(0);
      expect(r.signal).toBe(0);
    });

    it('K 線不足 21 根 → null', () => {
      const stock = mkCandles(new Array(20).fill(100));
      const spy = mkCandles(new Array(20).fill(200));
      const r = get(computeBreadth(stock, spy), 'rs20');
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
    });

    it('收盤價異常（≤ 0）→ null，永不 NaN', () => {
      const stock = mkCandles(new Array(25).fill(0));
      const spy = mkCandles(new Array(25).fill(200));
      const r = get(computeBreadth(stock, spy), 'rs20');
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
      expect(r.reason).toContain('退化');
    });
  });

  describe('Beta（252 日）', () => {
    it('個股報酬為大盤 2 倍 → Beta ≈ 2，signal 恆為 0', () => {
      const m = marketRets(252);
      const stock = mkCandles(fromReturns(m.map((x) => 2 * x)));
      const spy = mkCandles(fromReturns(m));
      const r = get(computeBreadth(stock, spy), 'beta252');
      expect(r.value).toBeCloseTo(2, 6);
      expect(r.signal).toBe(0);
    });

    it('Beta > 1.2 仍恆中立（不給方向）', () => {
      const m = marketRets(252);
      const stock = mkCandles(fromReturns(m.map((x) => 1.5 * x)));
      const spy = mkCandles(fromReturns(m));
      const r = get(computeBreadth(stock, spy), 'beta252');
      expect(r.value as number).toBeGreaterThan(1.2);
      expect(r.signal).toBe(0);
    });

    it('Beta ≤ 1.2 → signal 亦為 0', () => {
      const m = marketRets(252);
      const stock = mkCandles(fromReturns(m.map((x) => 0.5 * x)));
      const spy = mkCandles(fromReturns(m));
      const r = get(computeBreadth(stock, spy), 'beta252');
      expect(r.value).toBeCloseTo(0.5, 6);
      expect(r.signal).toBe(0);
    });

    it('SPY 無波動（變異數為 0）→ null，永不 NaN', () => {
      const m = marketRets(252);
      const stock = mkCandles(fromReturns(m));
      const spy = mkCandles(new Array(253).fill(200));
      const r = get(computeBreadth(stock, spy), 'beta252');
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
    });

    it('K 線不足 253 根 → null', () => {
      const stock = mkCandles(fromReturns(marketRets(99)));
      const spy = mkCandles(fromReturns(marketRets(99)));
      const r = get(computeBreadth(stock, spy), 'beta252');
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
    });
  });

  describe('RRG（50 日相對強弱＋10 日變化）', () => {
    it('相對強度上升 → +1', () => {
      // SPY 平盤、個股每日 +1% → 個股/SPY 比率持續上升
      const stock = mkCandles(fromReturns(new Array(49).fill(0.01)));
      const spy = mkCandles(new Array(50).fill(200));
      const r = get(computeBreadth(stock, spy), 'rrg');
      expect(r.signal).toBe(1);
      expect(r.value).toBeCloseTo(Math.pow(1.01, 10) - 1, 6);
    });

    it('相對強度下降 → −1', () => {
      const stock = mkCandles(fromReturns(new Array(49).fill(-0.01)));
      const spy = mkCandles(new Array(50).fill(200));
      const r = get(computeBreadth(stock, spy), 'rrg');
      expect(r.signal).toBe(-1);
      expect(r.value as number).toBeLessThan(0);
    });

    it('相對強度不變 → 0', () => {
      const stock = mkCandles(new Array(50).fill(100));
      const spy = mkCandles(new Array(50).fill(200));
      const r = get(computeBreadth(stock, spy), 'rrg');
      expect(r.value).toBe(0);
      expect(r.signal).toBe(0);
    });

    it('K 線不足 50 根 → null', () => {
      const stock = mkCandles(new Array(40).fill(100));
      const spy = mkCandles(new Array(40).fill(200));
      const r = get(computeBreadth(stock, spy), 'rrg');
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
    });

    it('SPY 收盤價異常（≤ 0）→ null，永不 NaN', () => {
      const stock = mkCandles(new Array(60).fill(100));
      const spy = mkCandles(new Array(60).fill(0));
      const r = get(computeBreadth(stock, spy), 'rrg');
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
      expect(r.reason).toContain('退化');
    });
  });

  it('所有 value 永不為 NaN/Infinity', () => {
    const cases: Array<[Candle[], Candle[] | null]> = [
      [mkCandles(new Array(300).fill(100)), mkCandles(new Array(300).fill(100))],
      [mkCandles([]), null],
      [mkCandles(new Array(5).fill(0)), mkCandles(new Array(5).fill(0))],
    ];
    for (const [stock, spy] of cases) {
      for (const r of computeBreadth(stock, spy)) {
        expect(
          r.value === null || Number.isFinite(r.value),
          `${r.id} value must be finite or null`,
        ).toBe(true);
      }
    }
  });
});
