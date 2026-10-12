/**
 * Pure math utilities shared by all technical indicators.
 * No external dependencies. All functions return `null` (never NaN/Infinity)
 * when the input data is insufficient for the requested period.
 */
import type { Candle } from './types';

/** True when `values` holds at least `period` entries for a valid period. */
function hasEnough(values: number[], period: number): boolean {
  return Number.isInteger(period) && period > 0 && values.length >= period;
}

/** Sum of the last `period` values. */
function trailingSum(values: number[], period: number): number {
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i];
  }
  return sum;
}

/**
 * Simple moving average of the trailing `period` values.
 * Returns null when values.length < period or period is invalid.
 */
export function sma(values: number[], period: number): number | null {
  if (!hasEnough(values, period)) return null;
  return trailingSum(values, period) / period;
}

/**
 * Exponential moving average over the full series.
 * Seeded with the SMA of the first `period` values (k = 2 / (period + 1)),
 * which is the standard TA convention.
 * Returns null when values.length < period or period is invalid.
 */
export function ema(values: number[], period: number): number | null {
  if (!hasEnough(values, period)) return null;
  const k = 2 / (period + 1);
  let result = trailingSum(values.slice(0, period), period) / period;
  for (let i = period; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

/**
 * Wilder's smoothing (used by RSI, ATR, etc.) over the full series.
 * Seeded with the SMA of the first `period` values, then
 * result = prev + (value - prev) / period for each subsequent value.
 * Returns null when values.length < period or period is invalid.
 */
export function wilderSmooth(values: number[], period: number): number | null {
  if (!hasEnough(values, period)) return null;
  let result = trailingSum(values.slice(0, period), period) / period;
  for (let i = period; i < values.length; i++) {
    result += (values[i] - result) / period;
  }
  return result;
}

/**
 * Population standard deviation (N divisor) of the trailing `period` values.
 * Matches the Bollinger Bands convention.
 * Returns null when values.length < period or period is invalid.
 */
export function stdev(values: number[], period: number): number | null {
  if (!hasEnough(values, period)) return null;
  const mean = trailingSum(values, period) / period;
  let sumSq = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / period);
}

/**
 * Highest high over the trailing `period` candles.
 * Returns null when candles.length < period or period is invalid.
 */
export function highestHigh(candles: Candle[], period: number): number | null {
  if (
    !Number.isInteger(period) ||
    period <= 0 ||
    candles.length < period
  ) {
    return null;
  }
  let max = -Infinity;
  for (let i = candles.length - period; i < candles.length; i++) {
    if (candles[i].h > max) max = candles[i].h;
  }
  return max;
}

/**
 * Lowest low over the trailing `period` candles.
 * Returns null when candles.length < period or period is invalid.
 */
export function lowestLow(candles: Candle[], period: number): number | null {
  if (
    !Number.isInteger(period) ||
    period <= 0 ||
    candles.length < period
  ) {
    return null;
  }
  let min = Infinity;
  for (let i = candles.length - period; i < candles.length; i++) {
    if (candles[i].l < min) min = candles[i].l;
  }
  return min;
}
