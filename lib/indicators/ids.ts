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

import type { Category, IDSResult, IndicatorResult, Signal } from './types';
import type { VariantResult, VariantIndicatorId } from './variants';
import type { FactorScore } from './factors';

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

/* ------------------------------------------------------------------ */
/* v1.1 三層 IDS 擴充（規格 §6.5）：Level 1 IDS-Period、Level 3 IDS-Factor */
/*                                                                   */
/* 設計：兩函數皆把各自的票源映射為「一票一權重」的 IndicatorResult，  */
/* 再呼叫上方未改動的 computeIDS——核心公式零重複。                  */
/*                                                                   */
/* 全域約束：三層 IDS 各自獨立呈現，不合成單一分數。                  */
/* ------------------------------------------------------------------ */

/** Level 3 中立區門檻 τ_F（v1.1 MVP；規格 §6.5.3：訓練期決定）。 */
const FACTOR_NEUTRAL_THRESHOLD = 5;

/** 變體指標家族對應的六大類（僅供 IndicatorResult 記帳，公式不使用）。 */
const CATEGORY_BY_VARIANT: Record<VariantIndicatorId, Category> = {
  RSI: 'momentum',
  ADX_DMI: 'trend',
  CMF: 'volume',
  ATR: 'volatility',
};

/** T/M/V 對應的六大類（僅供 IndicatorResult 記帳，公式不使用）。 */
const CATEGORY_BY_FACTOR: Record<'T' | 'M' | 'V', Category> = {
  T: 'trend',
  M: 'momentum',
  V: 'volume',
};

/** Level 1 IDS-Period 的回傳型別。 */
export interface IDSPeriodResult {
  /** 分歧分數（%）；無方向票（全中立或全 N/A）時為 null。 */
  idsPct: number | null;
  /** 有效變體數（signal 非 null 的變體個數）。 */
  validCount: number;
}

/** Level 3 IDS-Factor 的回傳型別。 */
export interface IDSFactorResult {
  /** 分歧分數（%）；無方向票時為 null。 */
  idsPct: number | null;
  upPct: number | null;
  downPct: number | null;
  neutralPct: number | null;
  /**
   * 有效因素數（T/M/V 中 score 非 null 的個數）。
   * 只有 1 項有效時不得宣稱三因素共識——呼叫方須標示證據不足。
   */
  validCount: number;
}

/**
 * Level 1：IDS-Period（同指標不同計算期間），規格 §6.5.1。
 *
 * 每個 signal 非 null 的變體投等權重一票；signal 為 null 的變體
 * 完全排除。票源映射後直接重用 computeIDS 的核心公式。
 * 所有有效期間皆中立時 idsPct 為 null（A=0），不誤顯示為 0%。
 */
export function computeIDSPeriod(variants: VariantResult[]): IDSPeriodResult {
  const votes: IndicatorResult[] = [];
  for (const v of variants) {
    if (v.signal === null) continue; // N/A 變體：完全排除
    votes.push({
      id: v.variantId,
      name: `${v.indicatorId}(${v.n})`,
      category: CATEGORY_BY_VARIANT[v.indicatorId],
      value: v.value,
      signal: v.signal,
      reason: '',
    });
  }
  const r = computeIDS(votes);
  return { idsPct: r.idsPct, validCount: votes.length };
}

/**
 * 因素方向票：s_F = sign(score_F)，|score| ≤ τ_F 視為中立，
 * score 為 null 時不投票。
 */
function factorSignal(score: number | null): Signal | null {
  if (score === null) return null;
  if (Math.abs(score) <= FACTOR_NEUTRAL_THRESHOLD) return 0;
  return score > 0 ? 1 : -1;
}

/**
 * Level 3：IDS-Factor（趨勢／動能／量能），規格 §6.5.3。
 *
 * T/M/V 各投等權重一票；score 為 null 的因素排除、用有效的算；
 * R（波動風險）無方向性，簽名層級即排除，絕不參與投票。
 * 票源映射後直接重用 computeIDS 的核心公式。
 */
export function computeIDSFactor(factors: {
  T: FactorScore;
  M: FactorScore;
  V: FactorScore;
}): IDSFactorResult {
  const entries: Array<['T' | 'M' | 'V', FactorScore]> = [
    ['T', factors.T],
    ['M', factors.M],
    ['V', factors.V],
  ];
  const votes: IndicatorResult[] = [];
  for (const [id, f] of entries) {
    const signal = factorSignal(f.score);
    if (signal === null) continue; // score 為 null：不投票
    votes.push({
      id: `FACTOR_${id}`,
      name: `因素${id}`,
      category: CATEGORY_BY_FACTOR[id],
      value: f.score,
      signal,
      reason: f.reason,
    });
  }
  const r = computeIDS(votes);
  return {
    idsPct: r.idsPct,
    upPct: r.upPct,
    downPct: r.downPct,
    neutralPct: r.neutralPct,
    validCount: votes.length,
  };
}
