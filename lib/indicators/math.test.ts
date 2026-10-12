import { describe, expect, it } from 'vitest';
import {
  ema,
  highestHigh,
  lowestLow,
  sma,
  stdev,
  wilderSmooth,
} from './math';
import type { Candle } from './types';

const candles: Candle[] = [
  { t: 1, o: 10, h: 12, l: 9, c: 11, v: 100 },
  { t: 2, o: 11, h: 14, l: 10, c: 13, v: 200 },
  { t: 3, o: 13, h: 13, l: 8, c: 9, v: 150 },
  { t: 4, o: 9, h: 16, l: 9, c: 15, v: 300 },
  { t: 5, o: 15, h: 15, l: 11, c: 12, v: 250 },
];

describe('sma', () => {
  it('sma([1,2,3,4,5],3) === 4', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4);
  });

  it('uses the trailing period values', () => {
    expect(sma([10, 1, 2, 3], 3)).toBe(2);
  });

  it('returns null when data is insufficient', () => {
    expect(sma([1, 2], 3)).toBeNull();
    expect(sma([], 3)).toBeNull();
    expect(sma([1, 2, 3], 0)).toBeNull();
  });
});

describe('ema', () => {
  it('first value equals the sma seed', () => {
    expect(ema([1, 2, 3], 3)).toBe(sma([1, 2, 3], 3));
  });

  it('continues smoothing beyond the seed window', () => {
    // k = 2/(3+1) = 0.5; seed = 2; ema = 4*0.5 + 2*0.5 = 3
    expect(ema([1, 2, 3, 4], 3)).toBeCloseTo(3, 10);
  });

  it('returns null when data is insufficient', () => {
    expect(ema([1, 2], 3)).toBeNull();
    expect(ema([], 3)).toBeNull();
  });
});

describe('wilderSmooth', () => {
  it('first value equals the sma seed', () => {
    expect(wilderSmooth([1, 2, 3], 3)).toBe(sma([1, 2, 3], 3));
  });

  it('continues with Wilder smoothing beyond the seed window', () => {
    // seed = 2; wilder = 2 + (4 - 2)/3 = 8/3
    expect(wilderSmooth([1, 2, 3, 4], 3)).toBeCloseTo(8 / 3, 10);
  });

  it('returns null when data is insufficient', () => {
    expect(wilderSmooth([1, 2], 3)).toBeNull();
    expect(wilderSmooth([], 3)).toBeNull();
  });
});

describe('stdev', () => {
  it('computes population stdev of trailing period values', () => {
    // mean=3, variance=(4+1+0+1+4)/5=2
    expect(stdev([1, 2, 3, 4, 5], 5)).toBeCloseTo(Math.SQRT2, 10);
  });

  it('returns null when data is insufficient', () => {
    expect(stdev([1, 2], 3)).toBeNull();
    expect(stdev([], 3)).toBeNull();
  });
});

describe('highestHigh / lowestLow', () => {
  it('finds max high over trailing period candles', () => {
    // trailing 3 highs: 13, 16, 15
    expect(highestHigh(candles, 3)).toBe(16);
    expect(highestHigh(candles, 5)).toBe(16);
  });

  it('finds min low over trailing period candles', () => {
    // trailing 3 lows: 8, 9, 11
    expect(lowestLow(candles, 3)).toBe(8);
    expect(lowestLow(candles, 5)).toBe(8);
  });

  it('returns null when data is insufficient', () => {
    expect(highestHigh(candles.slice(0, 2), 3)).toBeNull();
    expect(lowestLow(candles.slice(0, 2), 3)).toBeNull();
    expect(highestHigh([], 3)).toBeNull();
  });
});
