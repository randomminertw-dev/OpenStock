/**
 * 12 trend indicators with directional votes (+1 bullish / -1 bearish / 0 neutral).
 *
 * Voting rules (from the spec brief, followed verbatim):
 * - MA（SMA60）:      close > SMA60  → +1；< → −1；否則 0
 * - SMA（SMA200）:     close > SMA200 → +1；< → −1；否則 0
 * - EMA（EMA12/26）:  EMA12 > EMA26  → +1；< → −1；否則 0
 * - WMA（WMA20）:     close > WMA20  → +1；< → −1；否則 0
 * - MACD（12,26,9）:  柱狀值 > 0     → +1；< 0 → −1；否則 0
 * - ADX（14）:        ADX > 25 且 +DI > −DI → +1；ADX > 25 且 −DI > +DI → −1；否則 0
 * - DMI（14）:        +DI − −DI > 0  → +1；< 0 → −1；否則 0
 * - SAR:             close > SAR    → +1；< → −1（相等視為中性 0）
 * - Ichimoku:        close > 雲帶上緣 → +1；< 雲帶下緣 → −1；雲內 → 0
 *                    （只用已確認的歷史雲：取 26 根 K 線前算出、位移到當前位置的雲，不取未來值）
 * - Supertrend（ATR10×3）: close > 線 → +1；< → −1（相等視為中性 0）
 * - Aroon（25）:      AroonUp − AroonDown > 0 → +1；< 0 → −1；否則 0
 * - TRIX（EMA15 三重變化率）: > 0 → +1；< 0 → −1；否則 0
 *
 * Pure functions only; never returns NaN/Infinity.
 * Insufficient data → { value: null, signal: null, reason: '資料不足…' }.
 */

import { ema, sma } from './math';
import type { Candle, IndicatorResult, Signal } from './types';

/* ------------------------------------------------------------------ */
/* local series helpers (same seeding conventions as math.ts)          */
/* ------------------------------------------------------------------ */

/** Trailing sum of the last `period` values (caller guarantees length). */
function sumLast(values: number[], period: number): number {
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s;
}

function validPeriod(period: number): boolean {
  return Number.isInteger(period) && period > 0;
}

/**
 * Full EMA series, seeded with the SMA of the first `period` values
 * (k = 2 / (period + 1)) — the standard TA convention, identical to
 * math.ema for the final value. Positions before the seed are null.
 */
function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (!validPeriod(period) || values.length < period) return out;
  const k = 2 / (period + 1);
  let e = sumLast(values.slice(0, period), period) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/**
 * Full Wilder-smoothed series (used by ADX/DMI/ATR).
 * Seeded with the SMA of the first `period` values; positions before
 * the seed are null.
 */
function wilderSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (!validPeriod(period) || values.length < period) return out;
  let s = sumLast(values.slice(0, period), period) / period;
  out[period - 1] = s;
  for (let i = period; i < values.length; i++) {
    s += (values[i] - s) / period;
    out[i] = s;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* shared building blocks                                             */
/* ------------------------------------------------------------------ */

/** True range of one candle against the previous close. */
function trueRange(cur: Candle, prevClose: number): number {
  return Math.max(cur.h - cur.l, Math.abs(cur.h - prevClose), Math.abs(cur.l - prevClose));
}

/**
 * Weighted moving average of the trailing `period` closes.
 * Weights 1..period (most recent gets the highest weight) — the
 * standard WMA definition. Null on insufficient data.
 */
function wma(closes: number[], period: number): number | null {
  if (!validPeriod(period) || closes.length < period) return null;
  let weighted = 0;
  let weightSum = 0;
  for (let i = 0; i < period; i++) {
    const w = i + 1;
    weighted += closes[closes.length - period + i] * w;
    weightSum += w;
  }
  return weighted / weightSum;
}

/**
 * Wilder directional movement at the last bar.
 * ±DM and TR are Wilder-smoothed (period 14 per Wilder's original
 * DMI/ADX specification). ±DI are defined once the first smoothed
 * values exist (needs candles.length ≥ period + 1); ADX additionally
 * needs a full period of DX values (needs candles.length ≥ 2 × period).
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

  const last = tr.length - 1; // candle index n - 1
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
  // ADX = Wilder smoothing of DX (period 14, Wilder's original).
  // Null until a full period of DX values exists (needs 2 × period candles);
  // callers that only need ±DI (DMI) ignore this field.
  const adxS = wilderSeries(dx, period);
  const adx = adxS[adxS.length - 1];
  return { plusDI, minusDI, adx };
}

/**
 * Classic Parabolic SAR (Wilder's original: AF step 0.02, max 0.20).
 * Initial trend is seeded from the first two closes. Needs ≥ 2 candles.
 */
function parabolicSAR(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  const AF_STEP = 0.02; // Wilder 原始加速因子步長
  const AF_MAX = 0.2; // Wilder 原始加速因子上限
  let long = candles[1].c >= candles[0].c;
  let af = AF_STEP;
  let ep = long ? candles[0].h : candles[0].l;
  let sar = long ? candles[0].l : candles[0].h;
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const prev2 = i >= 2 ? candles[i - 2] : prev;
    let next = sar + af * (ep - sar);
    if (long) {
      // 多頭時 SAR 不得高於前兩根 K 線的最低價（標準箝制）
      next = Math.min(next, prev.l, prev2.l);
      if (cur.h > ep) {
        ep = cur.h;
        af = Math.min(af + AF_STEP, AF_MAX);
      }
      if (cur.l < next) {
        // 反轉為空頭
        long = false;
        sar = ep;
        ep = cur.l;
        af = AF_STEP;
      } else {
        sar = next;
      }
    } else {
      // 空頭時 SAR 不得低於前兩根 K 線的最高價（標準箝制）
      next = Math.max(next, prev.h, prev2.h);
      if (cur.l < ep) {
        ep = cur.l;
        af = Math.min(af + AF_STEP, AF_MAX);
      }
      if (cur.h > next) {
        // 反轉為多頭
        long = true;
        sar = ep;
        ep = cur.h;
        af = AF_STEP;
      } else {
        sar = next;
      }
    }
  }
  return sar;
}

/**
 * Supertrend line (ATR period 10, multiplier 3 — the most common
 * default, e.g. TradingView/Kaufman). Needs candles.length ≥ period + 1.
 */
function supertrendLine(candles: Candle[], period = 10, mult = 3): number | null {
  const n = candles.length;
  if (n < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < n; i++) tr.push(trueRange(candles[i], candles[i - 1].c));
  // ATR 為 Wilder 平滑的 TR（Wilder ATR 標準定義）
  const atrS = wilderSeries(tr, period);
  let dir: 1 | -1 = candles[1].c >= candles[0].c ? 1 : -1;
  let prevUpper = 0;
  let prevLower = 0;
  let st = 0;
  let started = false;
  for (let i = 0; i < tr.length; i++) {
    const atr = atrS[i];
    if (atr === null) continue;
    const cur = candles[i + 1];
    const hl2 = (cur.h + cur.l) / 2;
    const upperBasic = hl2 + mult * atr;
    const lowerBasic = hl2 - mult * atr;
    if (!started) {
      prevUpper = upperBasic;
      prevLower = lowerBasic;
      st = dir === 1 ? prevLower : prevUpper;
      started = true;
      continue;
    }
    const prevClose = candles[i].c;
    // 最終上下軌：順勢時跟隨基本軌，逆勢時沿用前值（標準遞迴定義）
    const finalUpper = prevClose > prevUpper ? upperBasic : Math.min(upperBasic, prevUpper);
    const finalLower = prevClose < prevLower ? lowerBasic : Math.max(lowerBasic, prevLower);
    if (cur.c > prevUpper) dir = 1;
    else if (cur.c < prevLower) dir = -1;
    st = dir === 1 ? finalLower : finalUpper;
    prevUpper = finalUpper;
    prevLower = finalLower;
  }
  return started ? st : null;
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
    category: 'trend',
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
  return { id, name, category: 'trend', value, signal: vote(sign), reason };
}

/* ------------------------------------------------------------------ */
/* computeTrend                                                       */
/* ------------------------------------------------------------------ */

/** ADX 趨勢強度門檻：Wilder 標準，ADX > 25 視為存在可交易趨勢 */
const ADX_TREND_THRESHOLD = 25;

/**
 * Compute the 12 trend indicators and their votes for the last candle.
 */
export function computeTrend(candles: Candle[]): IndicatorResult[] {
  const out: IndicatorResult[] = [];
  const n = candles.length;
  const closes = candles.map((c) => c.c);
  const close = n > 0 ? closes[n - 1] : NaN;

  // 1. MA（SMA60）— 60 日均線為中期趨勢常用分界（機構常用 50/60 日線）
  {
    const period = 60;
    const v = sma(closes, period);
    out.push(
      v === null
        ? notEnough('ma60', 'MA（SMA60）', period, n)
        : result(
            'ma60',
            'MA（SMA60）',
            v,
            Math.sign(close - v),
            `收盤 ${fmt(close)} ${close > v ? '>' : close < v ? '<' : '='} SMA60 ${fmt(v)}`,
          ),
    );
  }

  // 2. SMA（SMA200）— 200 日均線為長線牛熊分界（經典技術分析標準）
  {
    const period = 200;
    const v = sma(closes, period);
    out.push(
      v === null
        ? notEnough('sma200', 'SMA（SMA200）', period, n)
        : result(
            'sma200',
            'SMA（SMA200）',
            v,
            Math.sign(close - v),
            `收盤 ${fmt(close)} ${close > v ? '>' : close < v ? '<' : '='} SMA200 ${fmt(v)}`,
          ),
    );
  }

  // 3. EMA（EMA12 vs EMA26）— 短期均線在長期均線之上為多頭排列
  {
    const e12 = ema(closes, 12);
    const e26 = ema(closes, 26);
    out.push(
      e12 === null || e26 === null
        ? notEnough('ema1226', 'EMA（EMA12/26）', 26, n)
        : result(
            'ema1226',
            'EMA（EMA12/26）',
            e12 - e26,
            Math.sign(e12 - e26),
            `EMA12 ${fmt(e12)} ${e12 > e26 ? '>' : e12 < e26 ? '<' : '='} EMA26 ${fmt(e26)}`,
          ),
    );
  }

  // 4. WMA（WMA20）— 加權均線更貼近近期價格，20 為常用短中期參數
  {
    const period = 20;
    const v = wma(closes, period);
    out.push(
      v === null
        ? notEnough('wma20', 'WMA（WMA20）', period, n)
        : result(
            'wma20',
            'WMA（WMA20）',
            v,
            Math.sign(close - v),
            `收盤 ${fmt(close)} ${close > v ? '>' : close < v ? '<' : '='} WMA20 ${fmt(v)}`,
          ),
    );
  }

  // 5. MACD（12,26,9）— Appel 原始參數；柱狀值（DIF−訊號線）> 0 為多頭動能
  {
    const need = 26 + 9 - 1; // MACD 線需 26 根，訊號線需 9 個 MACD 值
    if (n < need) {
      out.push(notEnough('macd', 'MACD（12,26,9）', need, n));
    } else {
      const e12s = emaSeries(closes, 12);
      const e26s = emaSeries(closes, 26);
      const macdLine: number[] = [];
      for (let i = 25; i < n; i++) macdLine.push((e12s[i] as number) - (e26s[i] as number));
      // 訊號線 = MACD 線的 9 週期 EMA（Appel 標準）
      const signalLine = ema(macdLine, 9) as number;
      const dif = macdLine[macdLine.length - 1];
      const hist = dif - signalLine;
      out.push(
        result(
          'macd',
          'MACD（12,26,9）',
          hist,
          Math.sign(hist),
          `MACD 柱 ${fmt(hist, 4)} ${hist > 0 ? '>' : hist < 0 ? '<' : '='} 0`,
        ),
      );
    }
  }

  // 6. ADX（14）— Wilder 原始參數；ADX > 25 視為存在趨勢，再看 ±DI 方向
  {
    const period = 14;
    const need = 2 * period; // ADX 需 14 個 DX 值做 Wilder 平滑
    const dm = directionalMovement(candles, period);
    out.push(
      n < need || dm === null || dm.adx === null
        ? notEnough('adx14', 'ADX（14）', need, n)
        : result(
            'adx14',
            'ADX（14）',
            dm.adx,
            dm.adx > ADX_TREND_THRESHOLD
              ? Math.sign(dm.plusDI - dm.minusDI)
              : 0,
            dm.adx > ADX_TREND_THRESHOLD
              ? `ADX ${fmt(dm.adx)} > ${ADX_TREND_THRESHOLD} 且 +DI ${fmt(dm.plusDI)} ${dm.plusDI > dm.minusDI ? '>' : dm.plusDI < dm.minusDI ? '<' : '='} −DI ${fmt(dm.minusDI)}`
              : `ADX ${fmt(dm.adx)} 未達 ${ADX_TREND_THRESHOLD}（趨勢不明）`,
          ),
    );
  }

  // 7. DMI（14）— Wilder 原始參數；+DI 與 −DI 的差值決定方向
  {
    const period = 14;
    const need = period + 1; // ±DI 需第一組 Wilder 平滑值
    const dm = directionalMovement(candles, period);
    out.push(
      n < need || dm === null
        ? notEnough('dmi14', 'DMI（14）', need, n)
        : result(
            'dmi14',
            'DMI（14）',
            dm.plusDI - dm.minusDI,
            Math.sign(dm.plusDI - dm.minusDI),
            `+DI ${fmt(dm.plusDI)} − −DI ${fmt(dm.minusDI)} = ${fmt(dm.plusDI - dm.minusDI)}`,
          ),
    );
  }

  // 8. SAR — 拋物線轉向指標（Wilder 原始：AF 起始 0.02、步長 0.02、上限 0.20）
  {
    const v = parabolicSAR(candles);
    out.push(
      v === null
        ? notEnough('sar', 'SAR', 2, n)
        : result(
            'sar',
            'SAR',
            v,
            Math.sign(close - v),
            `收盤 ${fmt(close)} ${close > v ? '>' : close < v ? '<' : '='} SAR ${fmt(v)}`,
          ),
    );
  }

  // 9. Ichimoku — 一目均衡表標準參數（9/26/52）；只取 26 根 K 線前已確認的雲
  {
    const need = 26 + 52; // 雲需位移 26 根，且基準線需 52 根
    if (n < need) {
      out.push(notEnough('ichimoku', 'Ichimoku', need, n));
    } else {
      const i = n - 1 - 26; // 26 根 K 線前：該處算出的雲正好位移到當前 K 線
      const win = (k: number) => candles.slice(i - k + 1, i + 1);
      const mid = (k: number) => {
        const w = win(k);
        let hi = -Infinity;
        let lo = Infinity;
        for (const c of w) {
          if (c.h > hi) hi = c.h;
          if (c.l < lo) lo = c.l;
        }
        return (hi + lo) / 2;
      };
      const conv = mid(9); // 轉換線
      const base = mid(26); // 基準線
      const spanA = (conv + base) / 2; // 先行帶 A
      const spanB = mid(52); // 先行帶 B
      const upper = Math.max(spanA, spanB);
      const lower = Math.min(spanA, spanB);
      const sign = close > upper ? 1 : close < lower ? -1 : 0;
      out.push(
        result(
          'ichimoku',
          'Ichimoku',
          upper,
          sign,
          sign > 0
            ? `收盤 ${fmt(close)} > 雲帶上緣 ${fmt(upper)}`
            : sign < 0
              ? `收盤 ${fmt(close)} < 雲帶下緣 ${fmt(lower)}`
              : `收盤 ${fmt(close)} 在雲帶內（上緣 ${fmt(upper)}／下緣 ${fmt(lower)}）`,
        ),
      );
    }
  }

  // 10. Supertrend（ATR10×3）— 常用預設參數；收盤在線之上為多頭
  {
    const need = 10 + 1; // ATR10 需第一組 Wilder 平滑值
    const v = supertrendLine(candles, 10, 3);
    out.push(
      n < need || v === null
        ? notEnough('supertrend', 'Supertrend（ATR10×3）', need, n)
        : result(
            'supertrend',
            'Supertrend（ATR10×3）',
            v,
            Math.sign(close - v),
            `收盤 ${fmt(close)} ${close > v ? '>' : close < v ? '<' : '='} Supertrend ${fmt(v)}`,
          ),
    );
  }

  // 11. Aroon（25）— Tushar Chande 原始參數；AroonUp−AroonDown 決定方向
  {
    const period = 25;
    if (n < period) {
      out.push(notEnough('aroon25', 'Aroon（25）', period, n));
    } else {
      const win = candles.slice(n - period);
      // 以「最近一次」出現的位置計算 bars-since（並列極值取最新者）
      let hh = -Infinity;
      let ll = Infinity;
      let hhAgo = 0;
      let llAgo = 0;
      for (let k = 0; k < period; k++) {
        const ago = period - 1 - k; // 0 表示就在當前 K 線
        if (win[k].h >= hh) {
          hh = win[k].h;
          hhAgo = ago;
        }
        if (win[k].l <= ll) {
          ll = win[k].l;
          llAgo = ago;
        }
      }
      const aroonUp = (100 * (period - hhAgo)) / period;
      const aroonDown = (100 * (period - llAgo)) / period;
      const spread = aroonUp - aroonDown;
      out.push(
        result(
          'aroon25',
          'Aroon（25）',
          spread,
          Math.sign(spread),
          `AroonUp ${fmt(aroonUp, 1)} − AroonDown ${fmt(aroonDown, 1)} = ${fmt(spread, 1)}`,
        ),
      );
    }
  }

  // 12. TRIX（EMA15 三重變化率）— 15 為常用平滑參數；三重 EMA 變化率 > 0 為多頭
  {
    const period = 15;
    const need = 3 * period - 1; // 三重 EMA：每層需 15 個值，最後需兩個三重值求變化率
    if (n < need) {
      out.push(notEnough('trix15', 'TRIX（EMA15）', need, n));
    } else {
      const e1 = (emaSeries(closes, period) as number[]).filter(
        (x): x is number => x !== null,
      );
      const e2 = (emaSeries(e1, period) as number[]).filter((x): x is number => x !== null);
      const e3 = (emaSeries(e2, period) as number[]).filter((x): x is number => x !== null);
      const prev = e3[e3.length - 2];
      const last = e3[e3.length - 1];
      const trix = prev === 0 ? 0 : (100 * (last - prev)) / prev;
      out.push(
        result(
          'trix15',
          'TRIX（EMA15）',
          trix,
          Math.sign(trix),
          `TRIX ${fmt(trix, 4)}% ${trix > 0 ? '>' : trix < 0 ? '<' : '='} 0`,
        ),
      );
    }
  }

  return out;
}
