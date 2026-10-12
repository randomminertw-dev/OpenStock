/**
 * 7 market-breadth indicators with directional votes (+1 bullish / −1 bearish / 0 neutral).
 *
 * Voting rules (from the spec brief, followed verbatim):
 * - ADLine：   N/A（需全市場漲跌家數；目前無此資料源）
 * - TRIN：     N/A
 * - McClellan：N/A
 * - NewHighLow：N/A
 * - RS（20 日個股報酬 − SPY 報酬）: > 0 → +1；< 0 → −1；否則 0
 * - Beta（252 日）：Beta 本身為風險度量，signal 恆為 0（中立），value 照常輸出；
 *   Beta > 1.2 代表高波動，但不給方向 → 仍為 0
 * - RRG（50 日相對強弱＋10 日變化）：相對強度上升 → +1；下降 → −1；否則 0
 *
 * Value conventions (brief leaves these unspecified):
 * - RS 的 value 取個股 20 日報酬 − SPY 20 日報酬（小數；正數 = 跑贏大盤）。
 * - Beta 的 value 取普通最小平方法 Beta = Cov(個股日報酬, SPY 日報酬) /
 *   Var(SPY 日報酬)，252 日日報酬（253 根 K 線）。
 * - RRG 的 value 取相對強度比率（個股收盤／SPY 收盤）的 10 日變化率
 *   （ratio_now / ratio_10d − 1；小數；正數 = 相對強度上升）。
 *   「50 日」定義觀察窗：需要 50 根對齊的 K 線（10 日比較點須落在窗內）。
 * - 4 項 N/A 與缺 SPY 的情況 value/signal 皆為 null。
 *
 * Data-alignment convention:
 * - `candles` 與 `spyCandles` 以結尾對齊（最後一根為同一交易日），
 *   皆使用各自序列的尾部資料計算。
 *
 * Degenerate conventions (documented, kept null, never NaN):
 * - 計算報酬需要的任一收盤價 ≤ 0 → 無法定義報酬 → value/signal 為 null。
 * - SPY 252 日日報酬變異數為 0 → Beta 分母為零 → value/signal 為 null。
 * - RRG 的比率分母（SPY 收盤）≤ 0 或任一比率 ≤ 0 → value/signal 為 null。
 *
 * Pure functions only; never returns NaN/Infinity.
 * Insufficient data → { value: null, signal: null, reason: '資料不足…' }.
 */

import type { Candle, IndicatorResult, Signal } from './types';

/* ------------------------------------------------------------------ */
/* local helpers                                                      */
/* ------------------------------------------------------------------ */

const fmt = (x: number, digits = 2): string => x.toFixed(digits);

const fmtPct = (x: number, digits = 2): string => `${(x * 100).toFixed(digits)}%`;

/** RS 投票：value > 0 → +1；< 0 → −1；否則 0。 */
function vote(sign: number): Signal {
  return sign > 0 ? 1 : sign < 0 ? -1 : 0;
}

/** 無資料源、永遠 N/A 的指標（全市場漲跌家數等無此資料源）。 */
function na(id: string, name: string, reason: string): IndicatorResult {
  return { id, name, category: 'breadth', value: null, signal: null, reason };
}

/** Build the standard insufficient-data result. */
function notEnough(
  id: string,
  name: string,
  need: number,
  have: number,
): IndicatorResult {
  return {
    id,
    name,
    category: 'breadth',
    value: null,
    signal: null,
    reason: `資料不足（需要 ${need} 根 K 線，目前僅 ${have} 根）`,
  };
}

/** Build a normal result from a computed value and a raw comparison sign. */
function result(
  id: string,
  name: string,
  value: number | null,
  sign: number,
  reason: string,
): IndicatorResult {
  return { id, name, category: 'breadth', value, signal: vote(sign), reason };
}

/**
 * N-period simple return of the trailing candle closes:
 * c[n−1] / c[n−1−period] − 1.
 * Returns null when data is insufficient or any needed close ≤ 0.
 */
function trailingReturn(candles: Candle[], period: number): number | null {
  const n = candles.length;
  if (n < period + 1) return null;
  const now = candles[n - 1].c;
  const then = candles[n - 1 - period].c;
  if (!(then > 0) || !(now > 0)) return null;
  const r = now / then - 1;
  return Number.isFinite(r) ? r : null;
}

/**
 * Ordinary-least-squares Beta = Cov(stockRet, mktRet) / Var(mktRet)
 * from `days` trailing daily simple returns (needs days + 1 closes).
 * Returns null when data is insufficient, any close ≤ 0, or the market
 * variance is zero (degenerate: beta undefined, not neutral).
 */
function beta(candles: Candle[], market: Candle[], days: number): number | null {
  const n = candles.length;
  const m = market.length;
  if (n < days + 1 || m < days + 1) return null;
  const rs: number[] = new Array(days);
  const rm: number[] = new Array(days);
  for (let i = 0; i < days; i++) {
    const scNow = candles[n - days + i].c;
    const scPrev = candles[n - days - 1 + i].c;
    const mcNow = market[m - days + i].c;
    const mcPrev = market[m - days - 1 + i].c;
    if (!(scPrev > 0) || !(scNow > 0) || !(mcPrev > 0) || !(mcNow > 0)) {
      return null;
    }
    rs[i] = scNow / scPrev - 1;
    rm[i] = mcNow / mcPrev - 1;
  }
  let meanS = 0;
  let meanM = 0;
  for (let i = 0; i < days; i++) {
    meanS += rs[i];
    meanM += rm[i];
  }
  meanS /= days;
  meanM /= days;
  let cov = 0;
  let varM = 0;
  for (let i = 0; i < days; i++) {
    const ds = rs[i] - meanS;
    const dm = rm[i] - meanM;
    cov += ds * dm;
    varM += dm * dm;
  }
  if (!(varM > 0)) return null; // 市場無波動：Beta 無法定義
  const b = cov / varM;
  return Number.isFinite(b) ? b : null;
}

/**
 * 10-day change of the relative-strength ratio (stock close / market close):
 * ratio_now / ratio_10dAgo − 1.
 * Returns null when data is insufficient or any needed close ≤ 0.
 */
function rrgChange(
  candles: Candle[],
  market: Candle[],
  window: number,
  lookback: number,
): number | null {
  const n = candles.length;
  const m = market.length;
  if (n < window || m < window) return null;
  const scNow = candles[n - 1].c;
  const mcNow = market[m - 1].c;
  const scPrev = candles[n - 1 - lookback].c;
  const mcPrev = market[m - 1 - lookback].c;
  if (!(scNow > 0) || !(mcNow > 0) || !(scPrev > 0) || !(mcPrev > 0)) {
    return null;
  }
  const ratioNow = scNow / mcNow;
  const ratioPrev = scPrev / mcPrev;
  if (!(ratioPrev > 0)) return null;
  const change = ratioNow / ratioPrev - 1;
  return Number.isFinite(change) ? change : null;
}

/* ------------------------------------------------------------------ */
/* computeBreadth                                                     */
/* ------------------------------------------------------------------ */

/** N/A indicators: always null — no market-breadth data source exists. */
const NA_DEFS: Array<{ id: string; name: string; reason: string }> = [
  {
    id: 'adline',
    name: 'ADLine（累積漲跌線）',
    reason:
      '無資料源：需全市場漲跌家數才能計算累積漲跌線（N/A）',
  },
  {
    id: 'trin',
    name: 'TRIN（阿姆斯指數）',
    reason:
      '無資料源：需全市場上漲／下跌家數與成交量才能計算 TRIN（N/A）',
  },
  {
    id: 'mcclellan',
    name: 'McClellan Oscillator',
    reason:
      '無資料源：需全市場漲跌家數的指數移動平均才能計算（N/A）',
  },
  {
    id: 'newhighlow',
    name: 'NewHighLow（創新高低點）',
    reason:
      '無資料源：需全市場創新高／創新低家數才能計算（N/A）',
  },
];

/** RS 比較期間（20 日）。 */
const RS_PERIOD = 20;

/** Beta 回歸期間（252 日日報酬）。 */
const BETA_DAYS = 252;

/** RRG 觀察窗（50 日）與變化比較間隔（10 日）。 */
const RRG_WINDOW = 50;
const RRG_LOOKBACK = 10;

/**
 * Compute the 7 market-breadth indicators and their votes for the last candle.
 *
 * @param candles    個股 K 線（以結尾對齊）
 * @param spyCandles SPY 基準 K 線（以結尾對齊）；為 null 時 RS、Beta、RRG 皆為 null
 */
export function computeBreadth(
  candles: Candle[],
  spyCandles: Candle[] | null,
): IndicatorResult[] {
  const out: IndicatorResult[] = [];

  // 1–4. 全市場廣度指標 — 無資料源，恆為 null（無論 SPY 是否存在）
  for (const d of NA_DEFS) {
    out.push(na(d.id, d.name, d.reason));
  }

  // 5. RS（20 日個股報酬 − SPY 報酬）：
  //    > 0 → +1（跑贏大盤）；< 0 → −1（跑輸大盤）；= 0 → 0
  {
    const id = 'rs20';
    const name = 'RS（20 日個股報酬 − SPY）';
    if (spyCandles === null) {
      out.push({
        id,
        name,
        category: 'breadth',
        value: null,
        signal: null,
        reason: '無 SPY 基準資料，無法計算相對強弱（N/A）',
      });
    } else {
      const need = RS_PERIOD + 1;
      const have = Math.min(candles.length, spyCandles.length);
      if (have < need) {
        out.push(notEnough(id, name, need, have));
      } else {
        const stockRet = trailingReturn(candles, RS_PERIOD);
        const spyRet = trailingReturn(spyCandles, RS_PERIOD);
        if (stockRet === null || spyRet === null) {
          out.push({
            id,
            name,
            category: 'breadth',
            value: null,
            signal: null,
            reason: '退化資料：收盤價異常（≤ 0），無法計算報酬',
          });
        } else {
          const rs = stockRet - spyRet;
          const sign = rs > 0 ? 1 : rs < 0 ? -1 : 0;
          out.push(
            result(
              id,
              name,
              rs,
              sign,
              sign > 0
                ? `20 日報酬 ${fmtPct(stockRet)} 跑贏 SPY ${fmtPct(spyRet)}（相對強勢）`
                : sign < 0
                  ? `20 日報酬 ${fmtPct(stockRet)} 跑輸 SPY ${fmtPct(spyRet)}（相對弱勢）`
                  : `20 日報酬 ${fmtPct(stockRet)} 與 SPY 持平（相對中性）`,
            ),
          );
        }
      }
    }
  }

  // 6. Beta（252 日）：Beta = Cov(個股日報酬, SPY 日報酬) / Var(SPY 日報酬)；
  //    Beta 本身為風險度量，signal 恆為 0（中立），value 照常輸出；
  //    Beta > 1.2 代表高波動，但依 brief 不給方向 → 仍為 0。
  {
    const id = 'beta252';
    const name = 'Beta（252 日）';
    if (spyCandles === null) {
      out.push({
        id,
        name,
        category: 'breadth',
        value: null,
        signal: null,
        reason: '無 SPY 基準資料，無法計算 Beta（N/A）',
      });
    } else {
      const b = beta(candles, spyCandles, BETA_DAYS);
      if (b === null) {
        const need = BETA_DAYS + 1;
        const have = Math.min(candles.length, spyCandles.length);
        out.push(
          have < need
            ? notEnough(id, name, need, have)
            : {
                id,
                name,
                category: 'breadth',
                value: null,
                signal: null,
                reason: '退化資料：SPY 252 日無波動，Beta 無法定義',
              },
        );
      } else {
        out.push(
          result(
            id,
            name,
            b,
            0, // 風險度量，恆中立
            b > 1.2
              ? `Beta ${fmt(b)}（> 1.2 高波動，不給方向）`
              : `Beta ${fmt(b)}（風險度量，恆為中性）`,
          ),
        );
      }
    }
  }

  // 7. RRG（50 日相對強弱＋10 日變化）：
  //    相對強度比率（個股收盤／SPY 收盤）的 10 日變化率：
  //    上升 → +1；下降 → −1；不變 → 0
  {
    const id = 'rrg';
    const name = 'RRG（50 日相對強弱＋10 日變化）';
    if (spyCandles === null) {
      out.push({
        id,
        name,
        category: 'breadth',
        value: null,
        signal: null,
        reason: '無 SPY 基準資料，無法計算相對旋轉圖（N/A）',
      });
    } else {
      const have = Math.min(candles.length, spyCandles.length);
      if (have < RRG_WINDOW) {
        out.push(notEnough(id, name, RRG_WINDOW, have));
      } else {
        const change = rrgChange(candles, spyCandles, RRG_WINDOW, RRG_LOOKBACK);
        if (change === null) {
          out.push({
            id,
            name,
            category: 'breadth',
            value: null,
            signal: null,
            reason: '退化資料：收盤價異常（≤ 0），相對強度比率無法定義',
          });
        } else {
          const sign = change > 0 ? 1 : change < 0 ? -1 : 0;
          out.push(
            result(
              id,
              name,
              change,
              sign,
              sign > 0
                ? `相對強度比率 10 日上升 ${fmtPct(change)}（資金流入相對強勢）`
                : sign < 0
                  ? `相對強度比率 10 日下降 ${fmtPct(change)}（相對弱勢）`
                  : '相對強度比率 10 日持平（相對中性）',
            ),
          );
        }
      }
    }
  }

  return out;
}
