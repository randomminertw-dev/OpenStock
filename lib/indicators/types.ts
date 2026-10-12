/**
 * Core types for the 57-indicator voting + IDS (Indicator Disagreement Score) system.
 * Pure type definitions — no runtime code, no external dependencies.
 */

/** A single OHLCV candle. */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * An indicator's vote: 1 = bullish, -1 = bearish, 0 = neutral.
 * `null` is used at the IndicatorResult level when a signal cannot be computed.
 */
export type Signal = 1 | 0 | -1;

/** The six indicator families. */
export type Category =
  | 'trend'
  | 'momentum'
  | 'volatility'
  | 'volume'
  | 'support'
  | 'breadth';

/** The output of a single technical indicator. */
export interface IndicatorResult {
  id: string;
  name: string;
  category: Category;
  /** Raw indicator value; null when there is not enough data. */
  value: number | null;
  /** Vote; null when there is not enough data. */
  signal: Signal | null;
  /** Human-readable explanation of why this signal fired. */
  reason: string;
}

/** Aggregate result of the 57-indicator vote + Indicator Disagreement Score. */
export interface IDSResult {
  upPct: number | null;
  downPct: number | null;
  neutralPct: number | null;
  idsPct: number | null;
  consensusPct: number | null;
  coveragePct: number | null;
  entropyPct: number | null;
  direction: 'bullish' | 'bearish' | 'neutral';
}
