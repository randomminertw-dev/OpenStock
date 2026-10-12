/**
 * 多週期變體引擎（v1.1 規格 §4.1）：
 * 對四大核心指標家族 RSI、ADX/DMI、CMF、ATR，
 * 以 PERIOD_CANDIDATES = [7, 14, 20, 21, 28] 的每個 n 重新計算指標值
 * 與方向投票（方向投票沿用 v1.0 該指標的同一規則，只是換參數）。
 *
 * 公式邏輯與 v1.0 一致（Wilder RSI、Wilder 方向運動／ATR、
 * Chaikin CMF），n 參數化。v1.0 檔案不修改，這裡只重用
 * math.ts 的 wilderSmooth。
 *
 * 變體 ID 格式：{INDICATOR}__n{period}__{formula}_v1
 * （CMF 沒有平滑公式段 → CMF__n20__v1）。
 *
 * 注意：變體本身不是獨立選票——同族五個變體高度相關，
 * 權重／投票的合併是 Task 3 的事；這裡只負責算出變體。
 *
 * Pure functions only; never returns NaN/Infinity.
 * Insufficient data → { value: null, signal: null }.
 */

import { wilderSmooth } from './math';
import type { Candle, Signal } from './types';

/** v1.1 §4.1：四大核心因素的五候選期間。 */
export const PERIOD_CANDIDATES: readonly number[] = [7, 14, 20, 21, 28];

/** 支援多週期的四個指標家族。 */
export type VariantIndicatorId = 'RSI' | 'ADX_DMI' | 'CMF' | 'ATR';

/** 單一指標在某個期間 n 下的變體。 */
export interface VariantResult {
  variantId: string;
  indicatorId: VariantIndicatorId;
  n: number;
  /** Raw indicator value; null when there is not enough data. */
  value: number | null;
  /** Vote (v1.0 rule with period n); null when there is not enough data. */
  signal: Signal | null;
}

/* ------------------------------------------------------------------ */
/* local helpers (same definitions as v1.0 trend/volatility/volume)    */
/* ------------------------------------------------------------------ */

/** True range of one candle against the previous close. */
function trueRange(cur: Candle, prevClose: number): number {
  return Math.max(cur.h - cur.l, Math.abs(cur.h - prevClose), Math.abs(cur.l - prevClose));
}

/**
 * Full Wilder-smoothed series, seeded with the SMA of the first
 * `period` values; positions before the seed are null.
 */
function wilderSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (!Number.isInteger(period) || period <= 0 || values.length < period) return out;
  let s = 0;
  for (let i = 0; i < period; i++) s += values[i];
  s /= period;
  out[period - 1] = s;
  for (let i = period; i < values.length; i++) {
    s += (values[i] - s) / period;
    out[i] = s;
  }
  return out;
}

/**
 * Money Flow Multiplier（CLV，收盤位置值）: ((c−l) − (h−c)) / (h−l)。
 * 最高最低價相等時（無波動）定義為 0，避免除零。
 */
function moneyFlowMultiplier(c: Candle): number {
  const range = c.h - c.l;
  if (!(range > 0)) return 0;
  return ((c.c - c.l) - (c.h - c.c)) / range;
}

/**
 * Wilder directional movement at the last bar, parameterized by `period`.
 * ±DM and TR are Wilder-smoothed. ±DI are defined once the first smoothed
 * values exist (needs candles.length ≥ period + 1); ADX needs a full
 * period of DX values (needs candles.length ≥ 2 × period), else null.
 */
function directionalMovement(
  candles: Candle[],
  period: number,
): { plusDI: number; minusDI: number; adx: number | null } | null {
  const n = candles.length;
  if (n < period + 1) return null;
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < n; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const upMove = cur.h - prev.h;
    const downMove = prev.l - cur.l;
    // Wilder's rule: keep the larger move only when it is positive.
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(trueRange(cur, prev.c));
  }
  const sTR = wilderSeries(tr, period);
  const sPlus = wilderSeries(plusDM, period);
  const sMinus = wilderSeries(minusDM, period);

  const last = tr.length - 1;
  if (sTR[last] === null || sPlus[last] === null || sMinus[last] === null) return null;
  const str = sTR[last] as number;
  // TR is strictly positive unless every candle is a flat doji; guard anyway.
  const plusDI = str === 0 ? 0 : (100 * (sPlus[last] as number)) / str;
  const minusDI = str === 0 ? 0 : (100 * (sMinus[last] as number)) / str;

  // DX series from the first bar where ±DI are defined.
  const dx: number[] = [];
  for (let i = period - 1; i < tr.length; i++) {
    const t = sTR[i] as number;
    const p = t === 0 ? 0 : (100 * (sPlus[i] as number)) / t;
    const m = t === 0 ? 0 : (100 * (sMinus[i] as number)) / t;
    dx.push(p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m));
  }
  // ADX = Wilder smoothing of DX.
  const adxS = wilderSeries(dx, period);
  const adx = adxS[adxS.length - 1];
  return { plusDI, minusDI, adx };
}

/* ------------------------------------------------------------------ */
/* per-indicator variant calculators (v1.0 logic, parameterized n)     */
/* ------------------------------------------------------------------ */

/** RSI 超買超賣線：Wilder 原始定義（70/30） */
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

/** Wilder RSI(n)：漲跌變化經 Wilder 平滑；全程上漲 → 100，完全無波動 → 50。 */
function rsiVariant(candles: Candle[], n: number): { value: number; signal: Signal } | null {
  if (candles.length < n + 1) return null; // n 個漲跌變化值需 n+1 根 K 線
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const chg = candles[i].c - candles[i - 1].c;
    gains.push(Math.max(chg, 0));
    losses.push(Math.max(-chg, 0));
  }
  const avgGain = wilderSmooth(gains, n) as number;
  const avgLoss = wilderSmooth(losses, n) as number;
  const rsi =
    avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  const signal: Signal = rsi < RSI_OVERSOLD ? 1 : rsi > RSI_OVERBOUGHT ? -1 : 0;
  return { value: rsi, signal };
}

/**
 * ADX 趨勢強度門檻：Wilder 標準，ADX > 25 視為存在可交易趨勢。
 *
 * ADX/DMI 視為一個整體：value 取 ADX（Wilder 平滑的 DX），
 * signal 沿用 v1.0 ADX 規則（ADX > 25 且 +DI > −DI → +1；
 * ADX > 25 且 −DI > +DI → −1；否則 0）。
 * T 因素組裝（§4.2：T = ADX×(+DI−−DI)/(+DI+−DI)）是 Task 3 的事。
 */
const ADX_TREND_THRESHOLD = 25;

function adxDmiVariant(
  candles: Candle[],
  n: number,
): { value: number; signal: Signal } | null {
  if (candles.length < 2 * n) return null; // ADX 需 n 個 DX 值做 Wilder 平滑
  const dm = directionalMovement(candles, n);
  if (dm === null || dm.adx === null) return null;
  const signal: Signal =
    dm.adx > ADX_TREND_THRESHOLD ? ((dm.plusDI > dm.minusDI ? 1 : dm.plusDI < dm.minusDI ? -1 : 0) as Signal) : 0;
  return { value: dm.adx, signal };
}

/** Chaikin Money Flow(n)：Σ(資金流乘數 × 成交量) / Σ(成交量)。 */
function cmfVariant(candles: Candle[], n: number): { value: number; signal: Signal } | null {
  if (candles.length < n) return null;
  let mfvSum = 0;
  let volSum = 0;
  for (let i = candles.length - n; i < candles.length; i++) {
    mfvSum += moneyFlowMultiplier(candles[i]) * candles[i].v;
    volSum += candles[i].v;
  }
  if (!(volSum > 0)) return null; // 視窗總成交量為 0 → 資料不足
  const cmf = mfvSum / volSum;
  const signal: Signal = cmf > 0 ? 1 : cmf < 0 ? -1 : 0;
  return { value: cmf, signal };
}

/** ATR(n)：Wilder 平滑的真實波幅；純波動度量，signal 恆為 0（沿用 v1.0）。 */
function atrVariant(candles: Candle[], n: number): { value: number; signal: Signal } | null {
  if (candles.length < n + 1) return null; // 需 n 個 TR 值做 Wilder 平滑
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(trueRange(candles[i], candles[i - 1].c));
  }
  const a = wilderSmooth(tr, n);
  if (a === null) return null;
  return { value: a, signal: 0 };
}

/* ------------------------------------------------------------------ */
/* variant id + entry point                                            */
/* ------------------------------------------------------------------ */

const FORMULA_BY_INDICATOR: Record<VariantIndicatorId, string> = {
  RSI: 'wilder',
  ADX_DMI: 'wilder',
  CMF: '', // CMF 是簡單加權和，無平滑公式段
  ATR: 'wilder',
};

const CALCULATOR: Record<
  VariantIndicatorId,
  (candles: Candle[], n: number) => { value: number; signal: Signal } | null
> = {
  RSI: rsiVariant,
  ADX_DMI: adxDmiVariant,
  CMF: cmfVariant,
  ATR: atrVariant,
};

/**
 * 變體 ID：{INDICATOR}__n{period}__{formula}_v1
 * （公式段為空時尾段即 v1，例如 CMF__n20__v1）。
 */
function buildVariantId(indicatorId: VariantIndicatorId, n: number): string {
  const formula = FORMULA_BY_INDICATOR[indicatorId];
  const tail = formula ? `${formula}_v1` : 'v1';
  return [indicatorId, `n${n}`, tail].join('__');
}

/**
 * Compute the multi-period variants of one indicator family.
 * Returns one VariantResult per period in PERIOD_CANDIDATES, in order.
 */
export function computeVariants(
  candles: Candle[],
  indicatorId: VariantIndicatorId,
): VariantResult[] {
  const calc = CALCULATOR[indicatorId];
  return PERIOD_CANDIDATES.map((n) => {
    const r = calc(candles, n);
    return {
      variantId: buildVariantId(indicatorId, n),
      indicatorId,
      n,
      value: r === null ? null : r.value,
      signal: r === null ? null : r.signal,
    };
  });
}
