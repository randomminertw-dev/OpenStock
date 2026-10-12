/**
 * Aggregation engine: runs all six indicator families on the same candle
 * stream and tallies the 57 votes into an IDS (Indicator Disagreement Score).
 *
 * Pure aggregation — no filtering. A result with `signal: null` means "not
 * computable" and is passed straight through to `computeIDS` (which counts it
 * as non-voting); a result with `value: null, signal: 0` means "confirmed
 * neutral" (Fractals) and counts toward W0.
 */
import { computeTrend } from './trend';
import { computeMomentum } from './momentum';
import { computeVolatility } from './volatility';
import { computeVolume } from './volume';
import { computeSupport } from './support';
import { computeBreadth } from './breadth';
import { computeIDS } from './ids';
import type { Candle, IDSResult, IndicatorResult } from './types';

/** Run all 57 indicators on `candles` and aggregate the votes. */
export function computeAll(
  candles: Candle[],
  spyCandles: Candle[] | null,
): { results: IndicatorResult[]; ids: IDSResult } {
  const results: IndicatorResult[] = [
    ...computeTrend(candles),
    ...computeMomentum(candles),
    ...computeVolatility(candles),
    ...computeVolume(candles),
    ...computeSupport(candles),
    ...computeBreadth(candles, spyCandles),
  ];
  return { results, ids: computeIDS(results) };
}
