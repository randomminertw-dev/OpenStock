/**
 * IDS (Indicator Disagreement Score) computation engine.
 *
 * Spec §6.1: equal-weight vote aggregation across indicator signals.
 * Each indicator with a non-null signal carries weight 1; null-signal
 * (N/A) indicators are excluded entirely.
 *
 *   W+ = up votes (signal 1), W− = down votes (signal −1), W0 = neutral (signal 0)
 *   A  = W+ + W−                                    (directional votes)
 *   IDS        = 100 × (1 − |W+ − W−| / A); A = 0 → null (N/A)
 *   consensus  = 100 − IDS                          (null when IDS is null)
 *   coverage   = 100 × A / (W+ + W− + W0)            (null when no computable votes)
 *   entropy    = binary Shannon entropy of q = W+/A, × 100
 *                (0 when q is 0 or 1; null when A = 0)
 *   direction  = |W+ − W−| / (W+ + W− + W0) > 10% → majority side,
 *                otherwise neutral
 *
 * Pure function: no dependencies, no side effects, never returns NaN/Infinity.
 */

import type { IDSResult, IndicatorResult } from './types';

/** Minimum vote gap (share of all valid votes) that commits to a direction. */
const DIRECTION_GAP_THRESHOLD = 0.1;

/** Tally computable votes by signal. Null-signal indicators are skipped. */
function tallyVotes(results: IndicatorResult[]): {
  up: number;
  down: number;
  neutral: number;
} {
  let up = 0;
  let down = 0;
  let neutral = 0;
  for (const r of results) {
    if (r.signal === 1) {
      up += 1;
    } else if (r.signal === -1) {
      down += 1;
    } else if (r.signal === 0) {
      neutral += 1;
    }
    // signal === null → excluded entirely
  }
  return { up, down, neutral };
}

/** Binary Shannon entropy in bits for q ∈ [0,1]; 0 when q is 0 or 1. */
function binaryEntropy(q: number): number {
  if (q <= 0 || q >= 1) return 0;
  const log2q = Math.log(q) / Math.LN2;
  const log2c = Math.log(1 - q) / Math.LN2;
  return -(q * log2q + (1 - q) * log2c);
}

/**
 * Compute the Indicator Disagreement Score and derived metrics
 * from a set of indicator votes.
 */
export function computeIDS(results: IndicatorResult[]): IDSResult {
  const { up, down, neutral } = tallyVotes(results);
  const total = up + down + neutral; // votes with a computable signal
  const directional = up + down; // A = W+ + W−

  // Vote shares: percentage of all computable votes; null when there are none.
  const upPct = total > 0 ? (100 * up) / total : null;
  const downPct = total > 0 ? (100 * down) / total : null;
  const neutralPct = total > 0 ? (100 * neutral) / total : null;

  // Coverage: share of votes that took a directional stance.
  const coveragePct = total > 0 ? (100 * directional) / total : null;

  // IDS per spec §6.1; null when no directional votes exist.
  const idsPct = directional > 0 ? 100 * (1 - Math.abs(up - down) / directional) : null;

  // Consensus is the complement of disagreement.
  const consensusPct = idsPct === null ? null : 100 - idsPct;

  // Direction entropy over the up/down split; 0 at q = 0 or 1.
  const entropyPct = directional > 0 ? 100 * binaryEntropy(up / directional) : null;

  // Direction: strictly greater than a 10% gap commits to the majority side.
  let direction: IDSResult['direction'] = 'neutral';
  if (total > 0 && Math.abs(up - down) / total > DIRECTION_GAP_THRESHOLD) {
    direction = up > down ? 'bullish' : 'bearish';
  }

  return {
    upPct,
    downPct,
    neutralPct,
    idsPct,
    consensusPct,
    coveragePct,
    entropyPct,
    direction,
  };
}
