/**
 * Tests for the IDS (Indicator Disagreement Score) computation engine.
 *
 * Spec §6.1 (equal weights, weight = 1 per computable indicator):
 *   W+ = up votes, W− = down votes, W0 = neutral votes
 *   A = W+ + W−
 *   IDS = 100 × (1 − |W+ − W−| / A); A = 0 → null (N/A)
 *   consensus = 100 − IDS
 *   coverage = 100 × A / (W+ + W− + W0)
 *   entropy = binary Shannon entropy of q = W+/A, × 100 (0 when q is 0 or 1)
 *   direction: |W+ − W−| / (W+ + W− + W0) > 10% → majority side, else neutral
 *
 * Spec §6.4 worked example: W+ = 65%, W− = 25%, W0 = 10% → IDS = 55.56%.
 * Null-signal (N/A) indicators are excluded from all counts.
 */

import { describe, expect, it } from 'vitest';
import { computeIDS, computeIDSFactor, computeIDSPeriod } from './ids';
import type { Category, IndicatorResult, Signal } from './types';
import type { VariantResult } from './variants';
import type { FactorScore } from './factors';

let seq = 0;

function mock(signal: Signal | null): IndicatorResult {
  seq += 1;
  return {
    id: `test-indicator-${seq}`,
    name: `Test indicator ${seq}`,
    category: 'trend' as Category,
    value: signal === null ? null : 1,
    signal,
    reason: 'test fixture',
  };
}

/** Build a batch of indicator results with given vote counts (plus optional N/A entries). */
function batch(up: number, down: number, neutral: number, na = 0): IndicatorResult[] {
  const out: IndicatorResult[] = [];
  for (let i = 0; i < up; i++) out.push(mock(1));
  for (let i = 0; i < down; i++) out.push(mock(-1));
  for (let i = 0; i < neutral; i++) out.push(mock(0));
  for (let i = 0; i < na; i++) out.push(mock(null));
  return out;
}

/** Assert every pct field is a finite number or null — never NaN/Infinity. */
function expectSane(r: ReturnType<typeof computeIDS>): void {
  const fields = [
    r.upPct,
    r.downPct,
    r.neutralPct,
    r.idsPct,
    r.consensusPct,
    r.coveragePct,
    r.entropyPct,
  ] as const;
  for (const f of fields) {
    expect(f === null || Number.isFinite(f)).toBe(true);
  }
  expect(['bullish', 'bearish', 'neutral']).toContain(r.direction);
}

describe('computeIDS — spec §6.4 worked example (65/25/10)', () => {
  it('IDS is 55.56% (tolerance 0.01)', () => {
    const r = computeIDS(batch(65, 25, 10));
    expect(r.idsPct).not.toBeNull();
    // 100 × (1 − |65−25| / 90) = 100 × (50/90) = 55.5555…
    expect(Math.abs((r.idsPct as number) - 55.56)).toBeLessThan(0.01);
  });

  it('reports vote shares and derived metrics for 65/25/10', () => {
    const r = computeIDS(batch(65, 25, 10));
    expect(r.upPct).toBeCloseTo(65, 6);
    expect(r.downPct).toBeCloseTo(25, 6);
    expect(r.neutralPct).toBeCloseTo(10, 6);
    // coverage = 100 × 90 / 100
    expect(r.coveragePct).toBeCloseTo(90, 6);
    // consensus = 100 − 55.5555… = 44.4444…
    expect(r.consensusPct).not.toBeNull();
    expect(Math.abs((r.consensusPct as number) - 44.44)).toBeLessThan(0.01);
    // entropy: q = 65/90, H = −(q·log2 q + (1−q)·log2(1−q)) ≈ 0.85234 → 85.234
    expect(r.entropyPct).not.toBeNull();
    expect(r.entropyPct).toBeCloseTo(85.23, 1);
    expectSane(r);
  });

  it('direction is bullish when the gap exceeds 10% (40% here)', () => {
    const r = computeIDS(batch(65, 25, 10));
    // gap = (65 − 25) / 100 = 40% > 10%
    expect(r.direction).toBe('bullish');
  });

  it('direction is bearish for the mirrored 25/65/10 split', () => {
    const r = computeIDS(batch(25, 65, 10));
    expect(r.direction).toBe('bearish');
    expect(r.idsPct).not.toBeNull();
    expect(Math.abs((r.idsPct as number) - 55.56)).toBeLessThan(0.01);
  });
});

describe('computeIDS — boundary cases', () => {
  it('all bullish → IDS = 0, entropy = 0, consensus = 100', () => {
    const r = computeIDS(batch(57, 0, 0));
    expect(r.idsPct).toBe(0);
    expect(r.entropyPct).toBe(0);
    expect(r.consensusPct).toBe(100);
    expect(r.direction).toBe('bullish');
    expect(r.coveragePct).toBe(100);
    expectSane(r);
  });

  it('all bearish → IDS = 0, entropy = 0', () => {
    const r = computeIDS(batch(0, 57, 0));
    expect(r.idsPct).toBe(0);
    expect(r.entropyPct).toBe(0);
    expect(r.direction).toBe('bearish');
    expectSane(r);
  });

  it('tied up/down → IDS = 100, entropy = 100, direction neutral', () => {
    const r = computeIDS(batch(50, 50, 0));
    expect(r.idsPct).toBe(100);
    expect(r.entropyPct).toBeCloseTo(100, 6);
    expect(r.consensusPct).toBe(0);
    // gap = 0 / 100 = 0% → neutral
    expect(r.direction).toBe('neutral');
    expectSane(r);
  });

  it('all neutral → IDS/consensus/entropy are null, direction neutral', () => {
    const r = computeIDS(batch(0, 0, 57));
    expect(r.idsPct).toBeNull();
    expect(r.consensusPct).toBeNull();
    expect(r.entropyPct).toBeNull();
    // coverage = 100 × 0 / 57 = 0 (indicators ran but none voted directionally)
    expect(r.coveragePct).toBe(0);
    expect(r.neutralPct).toBe(100);
    expect(r.direction).toBe('neutral');
    expectSane(r);
  });

  it('empty input → all pct fields null, direction neutral, no NaN/Infinity', () => {
    const r = computeIDS([]);
    expect(r.upPct).toBeNull();
    expect(r.downPct).toBeNull();
    expect(r.neutralPct).toBeNull();
    expect(r.idsPct).toBeNull();
    expect(r.consensusPct).toBeNull();
    expect(r.coveragePct).toBeNull();
    expect(r.entropyPct).toBeNull();
    expect(r.direction).toBe('neutral');
    expectSane(r);
  });

  it('all N/A signals → same as empty input', () => {
    const r = computeIDS(batch(0, 0, 0, 30));
    expect(r.idsPct).toBeNull();
    expect(r.direction).toBe('neutral');
    expectSane(r);
  });
});

describe('computeIDS — direction threshold', () => {
  it('gap of 5% → neutral (must be strictly greater than 10%)', () => {
    const r = computeIDS(batch(45, 40, 15));
    // gap = (45 − 40) / 100 = 5% ≤ 10%
    expect(r.direction).toBe('neutral');
    expectSane(r);
  });

  it('gap of exactly 10% → neutral', () => {
    const r = computeIDS(batch(55, 45, 0));
    // gap = (55 − 45) / 100 = 10% → not > 10%
    expect(r.direction).toBe('neutral');
    expectSane(r);
  });

  it('gap just above 10% → takes the majority side', () => {
    const r = computeIDS(batch(56, 45, 0));
    // gap = 11 / 101 ≈ 10.89% > 10%
    expect(r.direction).toBe('bullish');
    expectSane(r);
  });
});

describe('computeIDS — null-signal (N/A) exclusion', () => {
  it('N/A indicators are excluded entirely from weights', () => {
    const r = computeIDS(batch(65, 25, 10, 30));
    expect(r.idsPct).not.toBeNull();
    expect(Math.abs((r.idsPct as number) - 55.56)).toBeLessThan(0.01);
    expect(r.upPct).toBeCloseTo(65, 6);
    expect(r.coveragePct).toBeCloseTo(90, 6);
    expect(r.direction).toBe('bullish');
    expectSane(r);
  });
});

/* ------------------------------------------------------------------ */
/* v1.1 Task 3: 三層 IDS — Level 1 IDS-Period、Level 3 IDS-Factor        */
/* ------------------------------------------------------------------ */

/** 變體測試夾具（value 與 signal 一致性由呼叫方保證）。 */
function variantFixture(
  n: number,
  signal: Signal | null,
  indicatorId: VariantResult['indicatorId'] = 'RSI',
): VariantResult {
  const formula = indicatorId === 'CMF' ? 'v1' : 'wilder_v1';
  return {
    variantId: `${indicatorId}__n${n}__${formula}`,
    indicatorId,
    n,
    value: signal === null ? null : 50,
    signal,
  };
}

/** 因素測試夾具。 */
function factorFixture(
  id: 'T' | 'M' | 'V' | 'R',
  score: number | null,
): FactorScore {
  return { id, score, n: 14, formulaVersion: 'test', reason: 'test fixture' };
}

/** 容差 0.01 的近似相等斷言（規格算例用）。 */
function expectPctClose(actual: number | null, expected: number): void {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThan(0.01);
}

describe('computeIDSPeriod — 規格 §6.5.1 / §6.5.4', () => {
  it('RSI 五週期 +/+/+/+/−（同權）→ idsPct === 40.0', () => {
    const variants = [7, 14, 20, 21, 28].map((n, i) =>
      variantFixture(n, i < 4 ? 1 : -1),
    );
    const r = computeIDSPeriod(variants);
    expect(r.validCount).toBe(5);
    expectPctClose(r.idsPct, 40.0);
  });

  it('五個全中立 → idsPct 為 null（不是 0%）', () => {
    const variants = [7, 14, 20, 21, 28].map((n) => variantFixture(n, 0));
    const r = computeIDSPeriod(variants);
    expect(r.validCount).toBe(5);
    expect(r.idsPct).toBeNull();
  });

  it('signal 為 null 的變體不計入 validCount', () => {
    const variants = [
      variantFixture(7, 1),
      variantFixture(14, null),
      variantFixture(20, -1),
    ];
    const r = computeIDSPeriod(variants);
    expect(r.validCount).toBe(2);
    // 1 上 1 下 → A=2，IDS = 100×(1−0/2) = 100
    expectPctClose(r.idsPct, 100.0);
  });

  it('空陣列 → idsPct 為 null，validCount 為 0', () => {
    const r = computeIDSPeriod([]);
    expect(r.validCount).toBe(0);
    expect(r.idsPct).toBeNull();
  });
});

describe('computeIDSFactor — 規格 §6.5.3', () => {
  it('T=+70, M=+40, V=−20 → 三票 2 上 1 下，idsPct = 66.67', () => {
    const r = computeIDSFactor({
      T: factorFixture('T', 70),
      M: factorFixture('M', 40),
      V: factorFixture('V', -20),
    });
    expect(r.validCount).toBe(3);
    // 100×(1−|2−1|/3) = 66.6667…
    expectPctClose(r.idsPct, 66.67);
    expect(r.upPct).toBeCloseTo(66.67, 2);
    expect(r.downPct).toBeCloseTo(33.33, 2);
    expect(r.neutralPct).toBeCloseTo(0, 6);
  });

  it('任一因素 score 為 null → 只用有效的算', () => {
    const r = computeIDSFactor({
      T: factorFixture('T', null),
      M: factorFixture('M', 40),
      V: factorFixture('V', -20),
    });
    expect(r.validCount).toBe(2);
    // 1 上 1 下 → IDS = 100
    expectPctClose(r.idsPct, 100.0);
  });

  it('T 的正負 1 倍 ATR 與 M/V 的正負 5 分各自視為中立', () => {
    const r = computeIDSFactor({
      T: factorFixture('T', 1),
      M: factorFixture('M', -5),
      V: factorFixture('V', 70),
    });
    expect(r.validCount).toBe(3);
    // 票：0、0、+1 → A=1，IDS = 100×(1−1/1) = 0
    expectPctClose(r.idsPct, 0.0);
    expect(r.neutralPct).toBeCloseTo(66.67, 2);
  });

  it('T 超出 1 倍 ATR 即投方向票，即使絕對值仍低於舊門檻 5', () => {
    const r = computeIDSFactor({
      T: factorFixture('T', -1.1),
      M: factorFixture('M', 5),
      V: factorFixture('V', 6),
    });
    expect(r.downPct).toBeCloseTo(33.33, 2);
    expect(r.upPct).toBeCloseTo(33.33, 2);
    expect(r.neutralPct).toBeCloseTo(33.33, 2);
  });

  it('三個全 null → idsPct 為 null，validCount 為 0', () => {
    const r = computeIDSFactor({
      T: factorFixture('T', null),
      M: factorFixture('M', null),
      V: factorFixture('V', null),
    });
    expect(r.validCount).toBe(0);
    expect(r.idsPct).toBeNull();
  });

  it('R 不參與：額外傳入 R 也不影響結果', () => {
    const base = {
      T: factorFixture('T', 70),
      M: factorFixture('M', 40),
      V: factorFixture('V', -20),
    };
    const withR = { ...base, R: factorFixture('R', -99) };
    const r = computeIDSFactor(withR);
    expect(r.validCount).toBe(3);
    expectPctClose(r.idsPct, 66.67);
  });
});
