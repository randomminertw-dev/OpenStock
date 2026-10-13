/**
 * v1.1 四因素計算引擎：T（趨勢）、M（動能）、V（量能）、R（波動風險）。
 *
 * 公式逐字採用規格書 §4.2（task-1-brief.md）：
 * - T = ADX × (+DI − −DI) / (+DI + −DI)，其中 DX = 100×|+DI−(−DI)|/(+DI+(−DI))、
 *   ADX = RMA(DX, n)；分母為 0 → score = null
 * - M = 2 × RSI − 100，RSI = 100 − 100/(1+RS)（Wilder RS）
 * - V = 100 × CMF，MFM = (2C−H−L)/(H−L)（H=L 時 MFM = 0）、CMF = Σ(MFM×VOL)/Σ(VOL)（n 期）
 * - R = 100 × percentile(ATR%_n, 過去 252 根)；ATR% = 100×ATR/C，ATR = RMA(TR, n)；
 *   不足 126 根 → score = null；平手排名採 average 法；R 無方向性
 *
 * 平滑一律採 Wilder RMA（首值以 SMA 初始化），與 v1.0 趨勢／動能模組一致。
 * R 的歷史分位只用 t 當下已存在的資料（不含未來資料）。
 */
import type { Candle } from './types';
import type { FactorPeriods } from './factor-periods';
import { wilderSmooth } from './math';

/** 四因素代號。 */
export type FactorId = 'T' | 'M' | 'V' | 'R';

/** 單一因素的計算結果。 */
export interface FactorScore {
  id: FactorId;
  /** 標準化分數；資料不足或公式無定義時為 null（R：0–100；T/M/V：−100–100）。 */
  score: number | null;
  /** 計算期間。 */
  n: number;
  /** 公式版本（標示平滑方法的實作選擇，供稽核）。 */
  formulaVersion: string;
  /** 繁體中文說明。 */
  reason: string;
  /** R 分位計算實際採用的有效 ATR% 樣本數。 */
  sampleCount?: number;
}

/** computeFactors 的回傳型別。 */
export interface FourFactors {
  T: FactorScore;
  M: FactorScore;
  V: FactorScore;
  R: FactorScore;
}

/** 預設計算期間（規格 §4.2 候選期間之一；v1.1 四因素 MVP 預設）。 */
const DEFAULT_N = 14;
/** R 歷史分位的回顧上限：截至 t 當下已存在的最近 252 筆 ATR%。 */
const R_LOOKBACK = 252;
/** R 歷史分位的最低筆數：不足 126 筆 → null。 */
const R_MIN_HISTORY = 126;

/**
 * 公式版本：Wilder RMA 平滑，首值以 SMA 初始化
 *（與 v1.0 trend.ts／momentum.ts 的 Wilder 實作同規格）。
 */
const FORMULA_VERSION = 'wilder-rma-v1';

/** 顯示用數字格式（reason 文字）。 */
function fmt(x: number, digits = 2): string {
  return x.toFixed(digits);
}

function validPeriod(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

function nullScore(
  id: FactorId,
  n: number,
  reason: string,
  sampleCount?: number,
): FactorScore {
  return {
    id, score: null, n, formulaVersion: FORMULA_VERSION, reason,
    ...(sampleCount === undefined ? {} : { sampleCount }),
  };
}

/**
 * Wilder 平滑全序列（供 ADX 的 DX 序列、R 的 ATR% 序列使用）。
 * 首值以第 1..period 個值的 SMA 初始化；seed 之前的位置為 null。
 * 與 trend.ts 的 wilderSeries 同規格。
 */
function wilderSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (!validPeriod(period) || values.length < period) return out;
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

/** 單根 K 線的真實波幅（Wilder 定義）。 */
function trueRange(cur: Candle, prevClose: number): number {
  return Math.max(
    cur.h - cur.l,
    Math.abs(cur.h - prevClose),
    Math.abs(cur.l - prevClose),
  );
}

/**
 * average 排名法的百分位（對應 pandas rank(pct=True, method='average')）：
 * rank 為 1-based 平均排名，percentile = (rank − 1) / (N − 1)，介於 0–1。
 */
function percentileAverageRank(values: number[], x: number): number {
  let less = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) less++;
    else if (v === x) equal++;
  }
  const rank = less + (equal + 1) / 2;
  return (rank - 1) / (values.length - 1);
}

/* ------------------------------------------------------------------ */
/* T：趨勢（ADX + DMI）                                                */
/* ------------------------------------------------------------------ */

/**
 * T = ADX × (+DI − −DI) / (+DI + −DI)。
 * ±DI 與 DX 皆採 Wilder 平滑；分母（+DI + −DI）為 0 → null。
 * ADX 需要 n 個 DX 值做 Wilder 平滑，故至少需要 2n 根 K 線。
 */
function computeT(candles: Candle[], n: number): FactorScore {
  const len = candles.length;
  if (!validPeriod(n)) {
    return nullScore('T', n, `計算期間 n=${n} 無效，T 無法計算`);
  }
  if (len < 2 * n) {
    return nullScore(
      'T',
      n,
      `資料不足：T（ADX/DMI）需要至少 ${2 * n} 根 K 線，目前 ${len} 根`,
    );
  }
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < len; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const upMove = cur.h - prev.h;
    const downMove = prev.l - cur.l;
    // Wilder 規則：只保留為正且較大的那一邊
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(trueRange(cur, prev.c));
  }
  const sTR = wilderSeries(tr, n);
  const sPlus = wilderSeries(plusDM, n);
  const sMinus = wilderSeries(minusDM, n);
  const last = tr.length - 1;
  const str = sTR[last] as number;
  // TR 全為 0（極端全平盤）時 ±DI 定義為 0，避免除零
  const plusDI = str === 0 ? 0 : (100 * (sPlus[last] as number)) / str;
  const minusDI = str === 0 ? 0 : (100 * (sMinus[last] as number)) / str;
  const denom = plusDI + minusDI;
  if (denom === 0) {
    return nullScore('T', n, '+DI 與 −DI 皆為 0（分母為零），T 無法計算');
  }
  // DX 序列：從 ±DI 首次有定義的位置開始
  const dx: number[] = [];
  for (let i = n - 1; i < tr.length; i++) {
    const t = sTR[i] as number;
    const p = t === 0 ? 0 : (100 * (sPlus[i] as number)) / t;
    const m = t === 0 ? 0 : (100 * (sMinus[i] as number)) / t;
    dx.push(p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m));
  }
  // dx 長度 = len − n ≥ n（因 len ≥ 2n），wilderSmooth 必有值
  const adx = wilderSmooth(dx, n) as number;
  const score = (adx * (plusDI - minusDI)) / denom;
  return {
    id: 'T',
    score,
    n,
    formulaVersion: FORMULA_VERSION,
    reason:
      `T = ADX(${n}) × (+DI − −DI) ÷ (+DI + −DI)` +
      ` = ${fmt(adx)} × ${fmt(plusDI - minusDI)} ÷ ${fmt(denom)}` +
      ` = ${fmt(score)}`,
  };
}

/* ------------------------------------------------------------------ */
/* M：動能（Wilder RSI）                                               */
/* ------------------------------------------------------------------ */

/**
 * M = 2 × RSI − 100；RSI = 100 − 100/(1+RS)（Wilder RS）。
 * 均跌幅為 0 時：全程上漲 → RSI = 100；完全無波動 → RSI = 50（中性）。
 */
function computeM(candles: Candle[], n: number): FactorScore {
  const len = candles.length;
  if (!validPeriod(n)) {
    return nullScore('M', n, `計算期間 n=${n} 無效，M 無法計算`);
  }
  if (len < n + 1) {
    return nullScore(
      'M',
      n,
      `資料不足：M（RSI）需要至少 ${n + 1} 根 K 線，目前 ${len} 根`,
    );
  }
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < len; i++) {
    const d = candles[i].c - candles[i - 1].c;
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const avgGain = wilderSmooth(gains, n) as number;
  const avgLoss = wilderSmooth(losses, n) as number;
  let rsi: number;
  if (avgLoss === 0) {
    rsi = avgGain === 0 ? 50 : 100;
  } else {
    const rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);
  }
  const score = 2 * rsi - 100;
  return {
    id: 'M',
    score,
    n,
    formulaVersion: FORMULA_VERSION,
    reason: `RSI(${n}) = ${fmt(rsi)}，M = 2 × RSI − 100 = ${fmt(score)}`,
  };
}

/* ------------------------------------------------------------------ */
/* V：量能（CMF）                                                     */
/* ------------------------------------------------------------------ */

/**
 * V = 100 × CMF；MFM = (2C−H−L)/(H−L)（H=L 時 MFM = 0，不崩潰）、
 * CMF = Σ(MFM×VOL) / Σ(VOL)（最近 n 期）。
 * n 期總成交量為 0 → null。
 */
function computeV(candles: Candle[], n: number): FactorScore {
  const len = candles.length;
  if (!validPeriod(n)) {
    return nullScore('V', n, `計算期間 n=${n} 無效，V 無法計算`);
  }
  if (len < n) {
    return nullScore(
      'V',
      n,
      `資料不足：V（CMF）需要至少 ${n} 根 K 線，目前 ${len} 根`,
    );
  }
  let mfvSum = 0;
  let volSum = 0;
  for (let i = len - n; i < len; i++) {
    const { h, l, c, v } = candles[i];
    const mfm = h === l ? 0 : (2 * c - h - l) / (h - l);
    mfvSum += mfm * v;
    volSum += v;
  }
  if (volSum === 0) {
    return nullScore('V', n, `近 ${n} 根 K 線總成交量為 0，CMF 無法計算`);
  }
  const cmf = mfvSum / volSum;
  const score = 100 * cmf;
  return {
    id: 'V',
    score,
    n,
    formulaVersion: FORMULA_VERSION,
    reason: `CMF(${n}) = ${fmt(cmf)}，V = 100 × CMF = ${fmt(score)}`,
  };
}

/* ------------------------------------------------------------------ */
/* R：波動風險（ATR% 的歷史分位）                                      */
/* ------------------------------------------------------------------ */

/**
 * R = 100 × percentile(ATR%_n, 過去 252 根)。
 * ATR% 序列只用 t 當下已存在的資料；有效筆數不足 126 → null；
 * 平手排名採 average 法；R 無方向性（0–100）。
 */
function computeR(candles: Candle[], n: number): FactorScore {
  const len = candles.length;
  if (!validPeriod(n)) {
    return nullScore('R', n, `計算期間 n=${n} 無效，R 無法計算`, 0);
  }
  if (len < n + 1) {
    return nullScore(
      'R',
      n,
      `資料不足：R（ATR%）需要至少 ${n + 1} 根 K 線，目前 ${len} 根`,
      0,
    );
  }
  const tr: number[] = [];
  for (let i = 1; i < len; i++) {
    tr.push(trueRange(candles[i], candles[i - 1].c));
  }
  const sTR = wilderSeries(tr, n);
  const atrPct: number[] = [];
  for (let i = n - 1; i < tr.length; i++) {
    const atr = sTR[i] as number;
    const c = candles[i + 1].c; // tr[i] 對應第 i+1 根 K 線
    if (c === 0) continue; // 價格為 0 時 ATR% 無定義，跳過該筆
    atrPct.push((100 * atr) / c);
  }
  const window = atrPct.slice(-R_LOOKBACK);
  if (window.length < R_MIN_HISTORY) {
    return nullScore(
      'R',
      n,
      `資料不足：R 需要至少 ${R_MIN_HISTORY} 筆 ATR% 歷史` +
        `（截至 t 當下已存在 ${window.length} 筆）`,
      window.length,
    );
  }
  const current = window[window.length - 1];
  const pct = percentileAverageRank(window, current);
  const score = 100 * pct;
  return {
    id: 'R',
    sampleCount: window.length,
    score,
    n,
    formulaVersion: FORMULA_VERSION,
    reason:
      `ATR%(${n}) = ${fmt(current)}%，為近 ${window.length} 根歷史的` +
      `第 ${fmt(100 * pct, 1)} 百分位（average 排名法），R = ${fmt(score)}`,
  };
}

/* ------------------------------------------------------------------ */

/**
 * 計算四大因素 T/M/V/R（預設 n = 14）。
 * 各因素獨立計算；任一因素資料不足或公式無定義時其 score 為 null，
 * 不影響其他因素。
 */
export function computeFactors(
  candles: Candle[],
  periods: number | FactorPeriods = DEFAULT_N,
): FourFactors {
  const ns = typeof periods === 'number'
    ? { T: periods, M: periods, V: periods, R: periods }
    : periods;
  return {
    T: computeT(candles, ns.T),
    M: computeM(candles, ns.M),
    V: computeV(candles, ns.V),
    R: computeR(candles, ns.R),
  };
}
