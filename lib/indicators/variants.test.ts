import { describe, expect, it } from 'vitest';
import { computeMomentum } from './momentum';
import { computeTrend } from './trend';
import { computeVolatility } from './volatility';
import { computeVolume } from './volume';
import type { Candle } from './types';
import { PERIOD_CANDIDATES, computeVariants } from './variants';

/**
 * 上升趨勢假資料：close = 300 + 2.5·i（60 根 K 線），
 * h = c + 0.5、l = c − 0.5、o = c − 0.2。
 * 資料量足夠所有變體（ADX_DMI n=28 需 56 根）計算。
 */
function makeUptrend(n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = 300 + 2.5 * i;
    out.push({ t: i, o: c - 0.2, h: c + 0.5, l: c - 0.5, c, v: 1000 });
  }
  return out;
}

/**
 * 非退化測試資料：正弦波＋緩漂移；h/l 以不同頻率擾動、
 * o 在 c 上下來回、v 亦波動。保證 RSI、ADX、CMF、ATR
 * 都不是解析常數（五個變體的值隨 n 變化），讓一致性斷言
 * 真正有鑑別力——能抓到實作錯誤，而不只是比對常數。
 */
function makeWave(n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = 300 + 15 * Math.sin(i * 0.7) + 0.5 * i;
    const h = c + 2 + Math.abs(Math.sin(i * 1.1));
    const l = c - 2 - Math.abs(Math.cos(i * 0.9));
    const o = c + 3 * Math.sin(i * 1.3);
    const v = 1000 + 500 * Math.sin(i * 0.5);
    out.push({ t: i, o, h, l, c, v });
  }
  return out;
}

/** 從 IndicatorResult[] 找出指定 id 的 value。 */
function v1Value(results: { id: string; value: number | null }[], id: string): number {  const r = results.find((x) => x.id === id);
  if (!r || r.value === null) throw new Error(`v1.0 指標 ${id} 無值`);
  return r.value;
}

function v1Signal(
  results: { id: string; signal: 1 | 0 | -1 | null }[],
  id: string,
): 1 | 0 | -1 {
  const r = results.find((x) => x.id === id);
  if (!r || r.signal === null) throw new Error(`v1.0 指標 ${id} 無方向`);
  return r.signal;
}

describe('multi-period variants (v1.1 §4.1)', () => {
  it('PERIOD_CANDIDATES 為 [7,14,20,21,28]', () => {
    expect(PERIOD_CANDIDATES).toEqual([7, 14, 20, 21, 28]);
  });

  it("computeVariants(candles, 'RSI') 回傳 5 個變體，ID 格式正確", () => {
    const vs = computeVariants(makeUptrend(60), 'RSI');
    expect(vs).toHaveLength(5);
    expect(vs.map((v) => v.variantId)).toEqual([
      'RSI__n7__wilder_v1',
      'RSI__n14__wilder_v1',
      'RSI__n20__wilder_v1',
      'RSI__n21__wilder_v1',
      'RSI__n28__wilder_v1',
    ]);
    for (const v of vs) {
      expect(v.indicatorId).toBe('RSI');
      expect(v.n).toBeGreaterThan(0);
    }
    expect(vs.map((v) => v.n)).toEqual([7, 14, 20, 21, 28]);
  });

  it('RSI n=14 的值與方向與 v1.0 單一 RSI 一致（容差 1e-6）', () => {
    const candles = makeUptrend(60);
    const vs = computeVariants(candles, 'RSI');
    const n14 = vs.find((v) => v.n === 14);
    expect(n14).toBeDefined();
    const v1 = v1Value(computeMomentum(candles), 'rsi14');
    expect(n14!.value).not.toBeNull();
    expect(Math.abs(n14!.value! - v1)).toBeLessThan(1e-6);
    expect(n14!.signal).toBe(v1Signal(computeMomentum(candles), 'rsi14'));
  });

  it('強上升趨勢下 RSI 各變體方向為 −1（超買，沿用 v1.0 投票規則）', () => {
    const vs = computeVariants(makeUptrend(60), 'RSI');
    for (const v of vs) {
      expect(v.value).toBeGreaterThan(70);
      expect(v.signal).toBe(-1);
    }
  });

  it("computeVariants(candles, 'ADX_DMI') 回傳 5 個變體，n=14 與 v1.0 ADX 一致", () => {
    const candles = makeUptrend(60);
    const vs = computeVariants(candles, 'ADX_DMI');
    expect(vs).toHaveLength(5);
    expect(vs.map((v) => v.variantId)).toEqual([
      'ADX_DMI__n7__wilder_v1',
      'ADX_DMI__n14__wilder_v1',
      'ADX_DMI__n20__wilder_v1',
      'ADX_DMI__n21__wilder_v1',
      'ADX_DMI__n28__wilder_v1',
    ]);
    const n14 = vs.find((v) => v.n === 14);
    expect(n14).toBeDefined();
    const v1 = v1Value(computeTrend(candles), 'adx14');
    expect(n14!.value).not.toBeNull();
    expect(Math.abs(n14!.value! - v1)).toBeLessThan(1e-6);
    expect(n14!.signal).toBe(v1Signal(computeTrend(candles), 'adx14'));
  });

  it("computeVariants(candles, 'CMF') 回傳 5 個變體（無公式段），n=20 與 v1.0 CMF 一致", () => {
    const candles = makeUptrend(60);
    const vs = computeVariants(candles, 'CMF');
    expect(vs).toHaveLength(5);
    expect(vs.map((v) => v.variantId)).toEqual([
      'CMF__n7__v1',
      'CMF__n14__v1',
      'CMF__n20__v1',
      'CMF__n21__v1',
      'CMF__n28__v1',
    ]);
    const n20 = vs.find((v) => v.n === 20);
    expect(n20).toBeDefined();
    const v1 = v1Value(computeVolume(candles), 'cmf20');
    expect(n20!.value).not.toBeNull();
    expect(Math.abs(n20!.value! - v1)).toBeLessThan(1e-6);
    expect(n20!.signal).toBe(v1Signal(computeVolume(candles), 'cmf20'));
  });

  it("computeVariants(candles, 'ATR') 回傳 5 個變體，n=14 與 v1.0 ATR 一致且方向恆為 0", () => {
    const candles = makeUptrend(60);
    const vs = computeVariants(candles, 'ATR');
    expect(vs).toHaveLength(5);
    expect(vs.map((v) => v.variantId)).toEqual([
      'ATR__n7__wilder_v1',
      'ATR__n14__wilder_v1',
      'ATR__n20__wilder_v1',
      'ATR__n21__wilder_v1',
      'ATR__n28__wilder_v1',
    ]);
    const n14 = vs.find((v) => v.n === 14);
    expect(n14).toBeDefined();
    const v1 = v1Value(computeVolatility(candles), 'atr14');
    expect(n14!.value).not.toBeNull();
    expect(Math.abs(n14!.value! - v1)).toBeLessThan(1e-6);
    expect(n14!.signal).toBe(0);
  });

  it('非退化資料（正弦波）下四指標變體與 v1.0 一致（容差 1e-6）', () => {
    const candles = makeWave(60);
    // 各指標對照 v1.0 的固定期間（CMF 的 v1.0 期間是 20，其餘為 14）
    const cases: {
      id: 'RSI' | 'ADX_DMI' | 'CMF' | 'ATR';
      n: number;
      v1id: string;
      v1results: { id: string; value: number | null; signal: 1 | 0 | -1 | null }[];
    }[] = [
      { id: 'RSI', n: 14, v1id: 'rsi14', v1results: computeMomentum(candles) },
      { id: 'ADX_DMI', n: 14, v1id: 'adx14', v1results: computeTrend(candles) },
      { id: 'CMF', n: 20, v1id: 'cmf20', v1results: computeVolume(candles) },
      { id: 'ATR', n: 14, v1id: 'atr14', v1results: computeVolatility(candles) },
    ];
    for (const c of cases) {
      const vs = computeVariants(candles, c.id);
      const target = vs.find((v) => v.n === c.n);
      expect(target).toBeDefined();
      expect(target!.value).not.toBeNull();
      const v1 = v1Value(c.v1results, c.v1id);
      expect(Math.abs(target!.value! - v1)).toBeLessThan(1e-6);
      expect(target!.signal).toBe(v1Signal(c.v1results, c.v1id));
      // 非退化守衛：五個變體的值不全相等（否則又是解析常數，斷言無鑑別力）
      expect(new Set(vs.map((v) => v.value)).size).toBeGreaterThan(1);
    }
  });

  it('資料不足時變體回傳 null（value 與 signal 同為 null）', () => {
    const few = makeUptrend(5);
    for (const id of ['RSI', 'ADX_DMI', 'CMF', 'ATR'] as const) {
      const vs = computeVariants(few, id);
      expect(vs).toHaveLength(5);
      for (const v of vs) {
        expect(v.value).toBeNull();
        expect(v.signal).toBeNull();
      }
    }
  });

  it('變體永不回傳 NaN/Infinity', () => {
    const candles = makeUptrend(60);
    for (const id of ['RSI', 'ADX_DMI', 'CMF', 'ATR'] as const) {
      for (const v of computeVariants(candles, id)) {
        if (v.value !== null) {
          expect(Number.isFinite(v.value)).toBe(true);
        }
      }
    }
  });
});

describe('非退化資料一致性（v1.1 §4.1 審查修正）', () => {
  // 以下一致性比對共用同一組 80 根正弦波 K 線（非退化：有漲有跌）
  const wave = () => makeWave(80);

  it('RSI n=14 變體與 v1.0 rsi14 一致（值容差 1e-6、方向相同），且 RSI 非退化（≠100）', () => {
    const candles = wave();
    const n14 = computeVariants(candles, 'RSI').find((v) => v.n === 14);
    expect(n14).toBeDefined();
    const v1 = computeMomentum(candles);
    expect(n14!.value).not.toBeNull();
    expect(Math.abs(n14!.value! - v1Value(v1, 'rsi14'))).toBeLessThan(1e-6);
    expect(n14!.signal).toBe(v1Signal(v1, 'rsi14'));
    // 非退化：資料有漲有跌，RSI 應為中間值而非恆 100
    expect(n14!.value!).toBeLessThan(100);
    expect(n14!.value!).toBeGreaterThan(0);
  });

  it('ADX/DMI n=14 變體與 v1.0 adx14 一致（值容差 1e-6、方向相同），且 ADX 非退化（≠100）', () => {
    const candles = wave();
    const n14 = computeVariants(candles, 'ADX_DMI').find((v) => v.n === 14);
    expect(n14).toBeDefined();
    const v1 = computeTrend(candles);
    expect(n14!.value).not.toBeNull();
    expect(Math.abs(n14!.value! - v1Value(v1, 'adx14'))).toBeLessThan(1e-6);
    expect(n14!.signal).toBe(v1Signal(v1, 'adx14'));
    // 非退化：震盪資料下 ADX 應為中間值而非恆 100
    expect(n14!.value!).toBeLessThan(100);
  });

  it('CMF n=20 變體與 v1.0 cmf20 一致（值容差 1e-6、方向相同），且 CMF 非退化（≠0）', () => {
    // v1.0 的 CMF 固定用 period=20（volume.ts），故此處以 n=20 變體比對
    const candles = wave();
    const n20 = computeVariants(candles, 'CMF').find((v) => v.n === 20);
    expect(n20).toBeDefined();
    const v1 = computeVolume(candles);
    expect(n20!.value).not.toBeNull();
    expect(Math.abs(n20!.value! - v1Value(v1, 'cmf20'))).toBeLessThan(1e-6);
    expect(n20!.signal).toBe(v1Signal(v1, 'cmf20'));
    // 非退化：震盪資料下 CMF 應為非零分數而非恆 0
    expect(n20!.value!).not.toBe(0);
  });

  it('ATR n=14 變體與 v1.0 atr14 一致（值容差 1e-6），方向恆為 0', () => {
    const candles = wave();
    const n14 = computeVariants(candles, 'ATR').find((v) => v.n === 14);
    expect(n14).toBeDefined();
    const v1 = computeVolatility(candles);
    expect(n14!.value).not.toBeNull();
    expect(Math.abs(n14!.value! - v1Value(v1, 'atr14'))).toBeLessThan(1e-6);
    expect(n14!.signal).toBe(0);
    expect(n14!.value!).toBeGreaterThan(0);
  });
});
