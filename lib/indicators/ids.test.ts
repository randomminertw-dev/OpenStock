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
import { computeIDS } from './ids';
import type { Category, IndicatorResult, Signal } from './types';

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
