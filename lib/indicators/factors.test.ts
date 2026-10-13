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
    const c = (dir === 1 ? 100 : 1000) + dir * 2 * i;
    out.push({ t: i, o: c - dir * 0.2, h: c + 0.5, l: c - 0.5, c, v: 1000 });
  }
  return out;
}

/** Close rises/falls by 1; H/L are ±1, making each true range exactly 2. */
function makeSpreadTrend(length: number, direction: 1 | -1): Candle[] {
  return Array.from({ length }, (_, i) => {
    const c = (direction === 1 ? 100 : 1000) + direction * i;
    return { t: i, o: c, h: c + 1, l: c - 1, c, v: 1000 };
  });
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

  it('SMA50−SMA200 除以 ATR21 保留趨勢正負方向', () => {
    const up = computeFactors(makeSpreadTrend(220, 1), { T: 21, M: 14, V: 14, R: 14 });
    expect(up.T.score).not.toBeNull();
    expect(up.T.score).toBeCloseTo(37.5, 8);
    expect(up.T.reason).toContain('SMA50');
    expect(up.T.reason).toContain('SMA200');
    expect(up.T.reason).toContain('ATR(21)');

    const down = computeFactors(makeSpreadTrend(220, -1), { T: 21, M: 14, V: 14, R: 14 });
    expect(down.T.score).toBeCloseTo(-37.5, 8);
  });

  it('趨勢 N 同步縮放兩條 SMA，N=5/42 對應 12/48 與 100/400', () => {
    const short = computeFactors(makeSpreadTrend(100, 1), { T: 5, M: 14, V: 14, R: 14 });
    expect(short.T.score).toBeCloseTo(9, 8);
    expect(short.T.reason).toContain('SMA12');
    expect(short.T.reason).toContain('SMA48');
    const long = computeFactors(makeSpreadTrend(420, 1), { T: 42, M: 14, V: 14, R: 14 });
    expect(long.T.score).toBeCloseTo(75, 8);
    expect(long.T.reason).toContain('SMA100');
    expect(long.T.reason).toContain('SMA400');
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
  it('uses each independent N without changing single-period formulas', () => {
    const candles = makeRSI70();
    const periods = { T: 7, M: 21, V: 10, R: 14 };
    const actual = computeFactors(candles, periods);
    for (const id of ['T', 'M', 'V', 'R'] as const) {
      expect(actual[id]).toEqual(computeFactors(candles, periods[id])[id]);
      expect(actual[id].n).toBe(periods[id]);
    }
    expect(computeFactors(candles).M).toEqual(computeFactors(candles, 14).M);
  });

  it('exposes the actual R percentile sample count including warmup and cap', () => {
    for (const [length, sampleCount] of [[10, 0], [50, 36], [139, 125], [140, 126], [300, 252]]) {
      const { R } = computeFactors(makeFlat(length));
      expect(R.sampleCount).toBe(sampleCount);
      expect(R.score === null).toBe(sampleCount < 126);
    }
    const candles = makeFlat(150);
    candles[149].c = 0;
    const invalidLatest = computeFactors(candles).R;
    expect(invalidLatest.sampleCount).toBe(135);
    expect(invalidLatest.atrPct).toBeUndefined();
    expect(invalidLatest.score).toBeNull();
    expect(computeFactors(makeFlat(150)).R.reason).toContain('136');
  });

  it('T：ATR 為零時不除零並回傳 N/A', () => {
    const { T } = computeFactors(makeFlat(220), { T: 21, M: 14, V: 14, R: 14 });
    expect(T.score).toBeNull();
    expect(T.reason).toContain('ATR');
  });

  it('T：少於 SMA200 所需 200 根時 N/A，其餘因素繼續計算', () => {
    const { T, M } = computeFactors(makeSpreadTrend(199, 1), { T: 21, M: 14, V: 14, R: 14 });
    expect(T.score).toBeNull();
    expect(T.reason).toContain('200');
    expect(M.score).not.toBeNull();
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

  it('R：歷史排名為零仍提供正的 ATR% 波動幅度', () => {
    const { R } = computeFactors(makeSpreadTrend(300, 1));
    expect(R.score).toBe(0);
    expect(R.sampleCount).toBe(252);
    expect(R.atrPct).toBeCloseTo(200 / 399, 8);
  });

  it('R：歷史不足以排名時仍提供可計算的 ATR%', () => {
    const { R } = computeFactors(makeSpreadTrend(100, 1));
    expect(R.score).toBeNull();
    expect(R.sampleCount).toBe(86);
    expect(R.atrPct).toBeCloseTo(200 / 199, 8);
  });

  it('所有因素皆回傳繁體中文 reason、n 與 formulaVersion', () => {
    const f = computeFactors(makeTrend(150, 1));
    for (const s of [f.T, f.M, f.V, f.R]) {
      expect(s.n).toBe(s.id === 'T' ? 21 : 14);
      expect(typeof s.formulaVersion).toBe('string');
      expect(s.formulaVersion.length).toBeGreaterThan(0);
      expect(typeof s.reason).toBe('string');
      expect(s.reason.length).toBeGreaterThan(0);
    }
  });
});
