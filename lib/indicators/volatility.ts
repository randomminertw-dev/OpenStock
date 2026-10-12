/**
 * 9 volatility indicators with directional votes (+1 bullish / -1 bearish / 0 neutral).
 *
 * Voting rules (from the spec brief, followed verbatim):
 * - BB（20,2）:        收盤 < 下軌 → +1（超賣反彈）；> 上軌 → −1；否則 0
 * - ATR（14）:         純波動度量，無方向 → signal 恆為 0
 * - Keltner（EMA20, ATR10×2）: 收盤 < 下軌 → +1；> 上軌 → −1；否則 0
 * - Donchian（20）:    收盤在通道上 25% → −1（過熱）；下 25% → +1；否則 0
 * - HV（20 日年化）:   純度量 → 恆 0
 * - StdDev（20）:      純度量 → 恆 0
 * - BBW:               純度量 → 恆 0
 * - Choppiness（14）:  > 61.8 → 0（盤整）；< 38.2 且趨勢向上 → +1；
 *                      < 38.2 且趨勢向下 → −1；否則 0
 * - NATR:              純度量 → 恆 0
 *
 * Value conventions (brief leaves these unspecified):
 * - 帶狀指標（BB/Keltner/Donchian）的 value 取「價格在帶內的位置 %」
 *   （0 = 下軌，100 = 上軌；突破時可 < 0 或 > 100），方便面板呈現。
 * - 純度量指標的 value 為原始讀數（ATR/StdDev 為價格單位；
 *   HV/NATR/BBW 以百分比表示）。
 *
 * Pure functions only; never returns NaN/Infinity.
 * Insufficient data → { value: null, signal: null, reason: '資料不足…' }.
 */

import { ema, highestHigh, lowestLow, sma, stdev, wilderSmooth } from './math';
import type { Candle, IndicatorResult, Signal } from './types';

/* ------------------------------------------------------------------ */
/* local series helpers                                               */
/* ------------------------------------------------------------------ */

/** True range of one candle against the previous close. */
function trueRange(cur: Candle, prevClose: number): number {
  return Math.max(cur.h - cur.l, Math.abs(cur.h - prevClose), Math.abs(cur.l - prevClose));
}

/** True-range series (length n − 1); null when there are fewer than `need` candles. */
function trueRangeSeries(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    out.push(trueRange(candles[i], candles[i - 1].c));
  }
  return out;
}

/**
 * ATR with Wilder smoothing of true range (Wilder's original definition).
 * Null when candles.length < period + 1 (fewer than `period` TR values).
 */
function atr(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  return wilderSmooth(trueRangeSeries(candles), period);
}

/**
 * Bollinger Bands（SMA ± mult × 母體標準差；母體標準差是 BB 標準定義）。
 * Null when candles are fewer than `period`.
 */
function bollinger(
  closes: number[],
  period: number,
  mult: number,
): { middle: number; upper: number; lower: number } | null {
  const middle = sma(closes, period);
  const sd = stdev(closes, period);
  if (middle === null || sd === null) return null;
  return { middle, upper: middle + mult * sd, lower: middle - mult * sd };
}

/**
 * Band position as a percentage: 0 = at the lower band, 100 = at the upper band.
 * May fall below 0 or above 100 on breakouts. Degenerate flat bands → 50.
 */
function bandPosition(close: number, lower: number, upper: number): number {
  if (!(upper > lower)) return 50;
  return (100 * (close - lower)) / (upper - lower);
}

/* ------------------------------------------------------------------ */
/* reason formatting                                                  */
/* ------------------------------------------------------------------ */

const fmt = (x: number, digits = 2): string => x.toFixed(digits);

function vote(sign: number): Signal {
  return sign > 0 ? 1 : sign < 0 ? -1 : 0;
}

/** Build the standard insufficient-data result. */
function notEnough(id: string, name: string, need: number, have: number): IndicatorResult {
  return {
    id,
    name,
    category: 'volatility',
    value: null,
    signal: null,
    reason: `資料不足（需要 ${need} 根 K 線，目前僅 ${have} 根）`,
  };
}

/** Build a normal result from a computed value and a raw comparison sign. */
function result(
  id: string,
  name: string,
  value: number,
  sign: number,
  reason: string,
): IndicatorResult {
  return { id, name, category: 'volatility', value, signal: vote(sign), reason };
}

/* ------------------------------------------------------------------ */
/* computeVolatility                                                  */
/* ------------------------------------------------------------------ */

/** Choppiness thresholds: 61.8 = 強盤整區，38.2 = 趨勢區（Fibonacci 比例） */
const CHOP_CHOPPY = 61.8;
const CHOP_TRENDY = 38.2;

/** 年化係數：一年 252 個交易日（美股標準） */
const TRADING_DAYS_PER_YEAR = 252;

/**
 * Compute the 9 volatility indicators and their votes for the last candle.
 */
export function computeVolatility(candles: Candle[]): IndicatorResult[] {
  const out: IndicatorResult[] = [];
  const n = candles.length;
  const closes = candles.map((c) => c.c);
  const close = n > 0 ? closes[n - 1] : NaN;

  // 1. BB（20,2）— John Bollinger 標準參數；跌破下軌視為超賣反彈（+1），
  //    突破上軌視為過熱（−1）
  {
    const period = 20;
    const bb = bollinger(closes, period, 2);
    out.push(
      bb === null
        ? notEnough('bb202', 'BB（20,2）', period, n)
        : result(
            'bb202',
            'BB（20,2）',
            bandPosition(close, bb.lower, bb.upper),
            close < bb.lower ? 1 : close > bb.upper ? -1 : 0,
            close < bb.lower
              ? `收盤 ${fmt(close)} 跌破下軌 ${fmt(bb.lower)}（超賣反彈）`
              : close > bb.upper
                ? `收盤 ${fmt(close)} 突破上軌 ${fmt(bb.upper)}（過熱）`
                : `收盤 ${fmt(close)} 在布林帶內（${fmt(bb.lower)}–${fmt(bb.upper)}）`,
          ),
    );
  }

  // 2. ATR（14）— Wilder 原始參數；純波動度量，無方向投票
  {
    const period = 14;
    const need = period + 1; // 需 14 個 TR 值做 Wilder 平滑
    const v = atr(candles, period);
    out.push(
      n < need || v === null
        ? notEnough('atr14', 'ATR（14）', need, n)
        : result('atr14', 'ATR（14）', v, 0, `ATR ${fmt(v)}（純波動度量，不投票）`),
    );
  }

  // 3. Keltner（EMA20, ATR10×2）— Chester Keltner 通道；
  //    跌破下軌 +1（超賣反彈），突破上軌 −1（過熱）
  {
    const need = 20; // EMA20 需 20 根（ATR10 只需 11 根）
    const middle = ema(closes, 20);
    const a = atr(candles, 10);
    out.push(
      n < need || middle === null || a === null
        ? notEnough('keltner2010', 'Keltner（EMA20, ATR10×2）', need, n)
        : (() => {
            const upper = middle + 2 * a;
            const lower = middle - 2 * a;
            const sign = close < lower ? 1 : close > upper ? -1 : 0;
            return result(
              'keltner2010',
              'Keltner（EMA20, ATR10×2）',
              bandPosition(close, lower, upper),
              sign,
              sign > 0
                ? `收盤 ${fmt(close)} 跌破肯特納下軌 ${fmt(lower)}（超賣反彈）`
                : sign < 0
                  ? `收盤 ${fmt(close)} 突破肯特納上軌 ${fmt(upper)}（過熱）`
                  : `收盤 ${fmt(close)} 在肯特納通道內（${fmt(lower)}–${fmt(upper)}）`,
            );
          })(),
    );
  }

  // 4. Donchian（20）— Richard Donchian 標準參數；收盤位置以通道高度的
  //    百分比衡量：上 25% 為過熱（−1），下 25% 為超賣（+1）
  {
    const period = 20;
    const hh = highestHigh(candles, period);
    const ll = lowestLow(candles, period);
    out.push(
      n < period || hh === null || ll === null
        ? notEnough('donchian20', 'Donchian（20）', period, n)
        : (() => {
            const pos = bandPosition(close, ll, hh);
            const sign = pos > 75 ? -1 : pos < 25 ? 1 : 0;
            return result(
              'donchian20',
              'Donchian（20）',
              pos,
              sign,
              sign < 0
                ? `收盤 ${fmt(close)} 位於唐奇安通道上 25%（${fmt(pos, 1)}%，過熱）`
                : sign > 0
                  ? `收盤 ${fmt(close)} 位於唐奇安通道下 25%（${fmt(pos, 1)}%，超賣）`
                  : `收盤 ${fmt(close)} 位於唐奇安通道中段（${fmt(pos, 1)}%）`,
            );
          })(),
    );
  }

  // 5. HV（20 日年化）— 20 日對數報酬率標準差 × √252 年化；
  //    純波動度量，無方向投票
  {
    const period = 20;
    const need = period + 1; // 20 個報酬率需 21 根 K 線
    if (n < need) {
      out.push(notEnough('hv20', 'HV（20 日年化）', need, n));
    } else {
      const rets: number[] = [];
      let ok = true;
      for (let i = n - period; i < n; i++) {
        const prev = closes[i - 1];
        const cur = closes[i];
        if (!(prev > 0) || !(cur > 0)) {
          ok = false;
          break;
        }
        rets.push(Math.log(cur / prev));
      }
      if (!ok || rets.length < period) {
        out.push(notEnough('hv20', 'HV（20 日年化）', need, n));
      } else {
        // 母體標準差（與本專案 math.stdev 一致）；年化以 252 交易日計
        const mean = rets.reduce((s, x) => s + x, 0) / period;
        let sumSq = 0;
        for (const r of rets) sumSq += (r - mean) * (r - mean);
        const hv = 100 * Math.sqrt(sumSq / period) * Math.sqrt(TRADING_DAYS_PER_YEAR);
        out.push(
          Number.isFinite(hv)
            ? result('hv20', 'HV（20 日年化）', hv, 0, `歷史波動率 ${fmt(hv, 1)}%（年化，純度量不投票）`)
            : notEnough('hv20', 'HV（20 日年化）', need, n),
        );
      }
    }
  }

  // 6. StdDev（20）— 20 日收盤價母體標準差；純波動度量，無方向投票
  {
    const period = 20;
    const v = stdev(closes, period);
    out.push(
      v === null
        ? notEnough('stdev20', 'StdDev（20）', period, n)
        : result('stdev20', 'StdDev（20）', v, 0, `20 日標準差 ${fmt(v)}（純波動度量，不投票）`),
    );
  }

  // 7. BBW（布林帶寬）— （上軌−下軌）／中軌 × 100；純波動度量，無方向投票
  {
    const period = 20;
    const bb = bollinger(closes, period, 2);
    out.push(
      bb === null
        ? notEnough('bbw', 'BBW（布林帶寬）', period, n)
        : bb.middle === 0
          ? notEnough('bbw', 'BBW（布林帶寬）', period, n)
          : result(
              'bbw',
              'BBW（布林帶寬）',
              (100 * (bb.upper - bb.lower)) / bb.middle,
              0,
              `布林帶寬 ${fmt((100 * (bb.upper - bb.lower)) / bb.middle, 2)}%（純波動度量，不投票）`,
            ),
    );
  }

  // 8. Choppiness（14）— E.W. Dreiss 震盪指數：
  //    100 × log10(ΣTR14 ／ (14 日最高−最低)) ／ log10(14)
  //    > 61.8 為盤整（0）；< 38.2 且視窗內淨漲跌決定方向
  {
    const period = 14;
    const need = period + 1; // ΣTR14 需 14 個 TR 值
    if (n < need) {
      out.push(notEnough('choppiness14', 'Choppiness（14）', need, n));
    } else {
      const trs = trueRangeSeries(candles);
      let sumTR = 0;
      for (let i = trs.length - period; i < trs.length; i++) sumTR += trs[i];
      const hh = highestHigh(candles, period) as number;
      const ll = lowestLow(candles, period) as number;
      const range = hh - ll;
      // 退化保護：零區間視為完全盤整（100）；ratio ≥ 1 保證 log10 非負
      const raw =
        range <= 0 ? 100 : (100 * Math.log10(Math.max(sumTR / range, 1))) / Math.log10(period);
      const chop = Math.min(100, Math.max(0, raw));
      // 趨勢方向：以 14 根視窗的淨漲跌判斷（與 CHOP 視窗一致）
      const trendSign = Math.sign(close - closes[n - period]);
      const sign =
        chop > CHOP_CHOPPY ? 0 : chop < CHOP_TRENDY ? trendSign : 0;
      out.push(
        result(
          'choppiness14',
          'Choppiness（14）',
          chop,
          sign,
          chop > CHOP_CHOPPY
            ? `Choppiness ${fmt(chop, 1)} > ${CHOP_CHOPPY}（盤整，無趨勢）`
            : chop < CHOP_TRENDY
              ? `Choppiness ${fmt(chop, 1)} < ${CHOP_TRENDY} 且視窗淨${trendSign > 0 ? '漲' : trendSign < 0 ? '跌' : '持平'}`
              : `Choppiness ${fmt(chop, 1)} 介於 ${CHOP_TRENDY}–${CHOP_CHOPPY}（方向不明）`,
        ),
      );
    }
  }

  // 9. NATR（14）— ATR／收盤價 × 100，標準化波動度；純度量，無方向投票
  {
    const period = 14;
    const need = period + 1;
    const a = atr(candles, period);
    out.push(
      n < need || a === null
        ? notEnough('natr14', 'NATR（14）', need, n)
        : close === 0
          ? notEnough('natr14', 'NATR（14）', need, n)
          : result(
              'natr14',
              'NATR（14）',
              (100 * a) / close,
              0,
              `NATR ${fmt((100 * a) / close, 2)}%（純波動度量，不投票）`,
            ),
    );
  }

  return out;
}
