import { describe, expect, it } from 'vitest';
import { computeFactors } from './factors';
import type { Candle } from './types';

/**
 * Task 1 測試：四因素計算引擎 T/M/V/R。
 * 斷言數值與公式逐字採用 task-1-brief.md。
 */

/**
 * RSI 恰為 70 的假資料 → M = 2×70 − 100 = 40。
 * 構造：30 根每根上漲 G，再 5 根每根下跌 1。
 * Wilder 平滑下 avgGain = G·r、avgLoss = 1·(1−r)，其中 r = (13/14)^5；
 * 取 G = (7/3)·(1−r)/r 使 RS = 7/3，RSI = 100 − 100/(1+7/3) = 70。
 */
function makeRSI70(): Candle[] {
  const r = Math.pow(13 / 14, 5);
  const G = ((7 / 3) * (1 - r)) / r;
  const out: Candle[] = [];
  let c = 100;
  for (let i = 0; i < 30; i++) {
    const prevC = c;
    c += G;
    out.push({ t: i, o: prevC, h: c + 0.1, l: prevC - 0.1, c, v: 1000 });
  }
  for (let k = 0; k < 5; k++) {
    const prevC = c;
    c -= 1;
    out.push({ t: 30 + k, o: prevC, h: prevC + 0.1, l: c - 0.1, c, v: 1000 });
  }
  return out;
}

/**
 * 等斜率趨勢假資料：上漲時 +DI >> −DI（−DM 恆為 0），下跌時反之。
 * 每根 h = c + 0.5、l = c − 0.5，TR 恆為 2.5。
 */
function makeTrend(n: number, dir: 1 | -1): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = 100 + dir * 2 * i;
    out.push({ t: i, o: c - dir * 0.2, h: c + 0.5, l: c - 0.5, c, v: 1000 });
  }
  return out;
}

/** 全平盤假資料：H = L，每根 o = h = l = c。 */
function makeFlat(n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: i, o: 100, h: 100, l: 100, c: 100, v: 1000 });
  }
  return out;
}

describe('computeFactors — brief 逐字斷言', () => {
  it('RSI=70 的假資料 → M=40（容差 0.01）', () => {
    const { M } = computeFactors(makeRSI70());
    expect(M.id).toBe('M');
    expect(M.n).toBe(14);
    expect(M.score).not.toBeNull();
    expect(Math.abs((M.score as number) - 40)).toBeLessThan(0.01);
  });

  it('+DI >> −DI 的趨勢資料 → T > 0；反之 T < 0', () => {
    const up = computeFactors(makeTrend(40, 1));
    expect(up.T.score).not.toBeNull();
    expect(up.T.score as number).toBeGreaterThan(0);

    const down = computeFactors(makeTrend(40, -1));
    expect(down.T.score).not.toBeNull();
    expect(down.T.score as number).toBeLessThan(0);
  });

  it('H=L 全平盤 → V 的 MFM=0，不崩潰', () => {
    const { V } = computeFactors(makeFlat(20));
    expect(V.score).toBe(0);
  });

  it('50 根 K 線 → R.score === null（不足 126）', () => {
    const { R } = computeFactors(makeTrend(50, 1));
    expect(R.score).toBeNull();
  });
});

describe('computeFactors — 邊界', () => {
  it('T：+DI 與 −DI 皆為 0（全平盤）→ 分母為零 → score=null', () => {
    const { T } = computeFactors(makeFlat(40));
    expect(T.score).toBeNull();
  });

  it('T：資料不足（少於 2n 根）→ score=null', () => {
    const { T } = computeFactors(makeTrend(10, 1));
    expect(T.score).toBeNull();
  });

  it('M：全程上漲 → RSI=100 → M=100', () => {
    const { M } = computeFactors(makeTrend(20, 1));
    expect(M.score).toBe(100);
  });

  it('M：全平盤 → RSI=50（中性）→ M=0', () => {
    const { M } = computeFactors(makeFlat(20));
    expect(M.score).toBe(0);
  });

  it('R：150 根 K 線 → score 落在 0–100（無方向性）', () => {
    const { R } = computeFactors(makeTrend(150, 1));
    expect(R.score).not.toBeNull();
    expect(R.score as number).toBeGreaterThanOrEqual(0);
    expect(R.score as number).toBeLessThanOrEqual(100);
  });

  it('所有因素皆回傳繁體中文 reason、n 與 formulaVersion', () => {
    const f = computeFactors(makeTrend(150, 1));
    for (const s of [f.T, f.M, f.V, f.R]) {
      expect(s.n).toBe(14);
      expect(typeof s.formulaVersion).toBe('string');
      expect(s.formulaVersion.length).toBeGreaterThan(0);
      expect(typeof s.reason).toBe('string');
      expect(s.reason.length).toBeGreaterThan(0);
    }
  });
});
