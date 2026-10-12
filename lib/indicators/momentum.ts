/**
 * 12 momentum indicators with directional votes (+1 bullish / -1 bearish / 0 neutral).
 *
 * Voting rules (from the spec brief, followed verbatim):
 * - RSI（14）:        < 30 → +1；> 70 → −1；否則 0
 * - KD（9,3,3）:      K−D > 0 → +1；< 0 → −1；否則 0
 * - KDJ:             J=3K−2D；J > D → +1；J < D → −1；否則 0
 * - CCI（20）:        < −100 → +1；> 100 → −1；否則 0
 * - ROC（12）:        > 0 → +1；< 0 → −1；否則 0
 * - MOM（10）:        > 0 → +1；< 0 → −1；否則 0
 * - WilliamsR（14）:  < −80 → +1；> −20 → −1；否則 0
 * - TSI（25,13）:     > 0 → +1；< 0 → −1；否則 0
 * - PPO（12,26,9）:   柱值 > 0 → +1；< 0 → −1；否則 0
 * - BIAS（vs SMA20）: < −5% → +1；> 5% → −1；否則 0
 * - DPO（20）:        > 0 → +1；< 0 → −1；否則 0（因果位移計算，不取未來值）
 * - UltimateOsc（7,14,28）: < 30 → +1；> 70 → −1；否則 0
 *
 * Pure functions only; never returns NaN/Infinity.
 * Insufficient data → { value: null, signal: null, reason: '資料不足…' }.
 */

import { ema, highestHigh, lowestLow, sma, wilderSmooth } from './math';
import type { Candle, IndicatorResult, Signal } from './types';

/* ------------------------------------------------------------------ */
/* voting thresholds (hardcoded, with technical basis)                 */
/* ------------------------------------------------------------------ */

/** RSI 超買超賣線：Wilder 原始定義（70/30） */
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;
/** CCI 常態偏離帶邊界：Lambert 原始定義（±100；約 70–80% 讀數落在帶內） */
const CCI_OVERBOUGHT = 100;
const CCI_OVERSOLD = -100;
/** Williams %R 超買超賣線：Williams 原始定義（−20/−80） */
const WR_OVERBOUGHT = -20;
const WR_OVERSOLD = -80;
/** BIAS 乖離率過熱/超賣參考：日線 SMA20 常用正負 5% */
const BIAS_OVERBOUGHT_PCT = 5;
const BIAS_OVERSOLD_PCT = -5;
/** Ultimate Oscillator 超買超賣線：Williams 原始定義（70/30） */
const UO_OVERBOUGHT = 70;
const UO_OVERSOLD = 30;

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

/** Drop nulls from a seeded series (caller guarantees enough non-null values). */
function compact(series: (number | null)[]): number[] {
  return series.filter((x): x is number => x !== null);
}

/* ------------------------------------------------------------------ */
/* reason formatting                                                  */
/* ------------------------------------------------------------------ */

const fmt = (x: number, digits = 2): string => x.toFixed(digits);

const cmp = (a: number, b: number): string => (a > b ? '>' : a < b ? '<' : '=');

function vote(sign: number): Signal {
  return sign > 0 ? 1 : sign < 0 ? -1 : 0;
}

/** Build the standard insufficient-data result. */
function notEnough(id: string, name: string, need: number, have: number): IndicatorResult {
  return {
    id,
    name,
    category: 'momentum',
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
  return { id, name, category: 'momentum', value, signal: vote(sign), reason };
}

/* ------------------------------------------------------------------ */
/* computeMomentum                                                    */
/* ------------------------------------------------------------------ */

/**
 * Compute the 12 momentum indicators and their votes for the last candle.
 */
export function computeMomentum(candles: Candle[]): IndicatorResult[] {
  const out: IndicatorResult[] = [];
  const n = candles.length;
  const closes = candles.map((c) => c.c);
  const close = n > 0 ? closes[n - 1] : NaN;

  // 1. RSI（14）— Wilder 原始參數與 Wilder 平滑；70/30 為原始超買超賣線
  {
    const period = 14;
    const need = period + 1; // 14 個漲跌變化值需 15 根 K 線
    if (n < need) {
      out.push(notEnough('rsi14', 'RSI（14）', need, n));
    } else {
      const gains: number[] = [];
      const losses: number[] = [];
      for (let i = 1; i < n; i++) {
        const chg = closes[i] - closes[i - 1];
        gains.push(Math.max(chg, 0));
        losses.push(Math.max(-chg, 0));
      }
      const avgGain = wilderSmooth(gains, period) as number;
      const avgLoss = wilderSmooth(losses, period) as number;
      // 全程上漲時 avgLoss=0 → RSI=100；完全無波動時定義為 50（中性）
      const rsi =
        avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
      const sign = rsi < RSI_OVERSOLD ? 1 : rsi > RSI_OVERBOUGHT ? -1 : 0;
      out.push(
        result(
          'rsi14',
          'RSI（14）',
          rsi,
          sign,
          rsi < RSI_OVERSOLD
            ? `RSI ${fmt(rsi, 1)} < 30（超賣）`
            : rsi > RSI_OVERBOUGHT
              ? `RSI ${fmt(rsi, 1)} > 70（超買）`
              : `RSI ${fmt(rsi, 1)} 在 30–70 中性區間`,
        ),
      );
    }
  }

  // 2–3. KD / KDJ 共用底層隨機指標
  // （George Lane 原始：RSV 週期 9，K、D 各取 3 期 SMA 平滑）
  const kdNeed = 9 + 3 + 3 - 2; // 13：RSV 需 9 根，K 需 3 個 RSV，D 需 3 個 K
  let kd: { k: number; d: number } | null = null;
  if (n >= kdNeed) {
    const rsv: number[] = [];
    for (let i = 8; i < n; i++) {
      const win = candles.slice(i - 8, i + 1);
      let hh = -Infinity;
      let ll = Infinity;
      for (const c of win) {
        if (c.h > hh) hh = c.h;
        if (c.l < ll) ll = c.l;
      }
      // 零波動窗口（hh=ll）時 RSV 取中性 50，避免除以零
      rsv.push(hh === ll ? 50 : (100 * (closes[i] - ll)) / (hh - ll));
    }
    const kSeries: number[] = [];
    for (let i = 2; i < rsv.length; i++) {
      kSeries.push(sumLast(rsv.slice(0, i + 1), 3) / 3);
    }
    const dSeries: number[] = [];
    for (let i = 2; i < kSeries.length; i++) {
      dSeries.push(sumLast(kSeries.slice(0, i + 1), 3) / 3);
    }
    kd = { k: kSeries[kSeries.length - 1], d: dSeries[dSeries.length - 1] };
  }

  // 2. KD（9,3,3）— K−D 差值決定方向（與 MACD 柱同理，回報投票驅動值）
  {
    if (kd === null) {
      out.push(notEnough('kd933', 'KD（9,3,3）', kdNeed, n));
    } else {
      const spread = kd.k - kd.d;
      out.push(
        result(
          'kd933',
          'KD（9,3,3）',
          spread,
          Math.sign(spread),
          `K ${fmt(kd.k, 1)} ${cmp(kd.k, kd.d)} D ${fmt(kd.d, 1)}（K−D = ${fmt(spread, 2)}）`,
        ),
      );
    }
  }

  // 3. KDJ — J = 3K−2D（J 對 K−D 的三倍放大）；J−D = 3(K−D)，與 KD 同號
  {
    if (kd === null) {
      out.push(notEnough('kdj', 'KDJ', kdNeed, n));
    } else {
      const j = 3 * kd.k - 2 * kd.d;
      const spread = j - kd.d;
      out.push(
        result(
          'kdj',
          'KDJ',
          spread,
          Math.sign(spread),
          `J ${fmt(j, 1)} ${cmp(j, kd.d)} D ${fmt(kd.d, 1)}（J = 3K−2D）`,
        ),
      );
    }
  }

  // 4. CCI（20）— Lambert 原始參數；常數 0.015 使約 70–80% 讀數落在 ±100 內
  {
    const period = 20;
    if (n < period) {
      out.push(notEnough('cci20', 'CCI（20）', period, n));
    } else {
      // 典型價格 TP = (H+L+C)/3（Lambert 原始定義）
      const tps = candles.map((c) => (c.h + c.l + c.c) / 3);
      const basis = sma(tps, period) as number;
      let md = 0;
      for (let i = n - period; i < n; i++) md += Math.abs(tps[i] - basis);
      md /= period;
      // 零波動時 CCI 定義為 0（中性），避免除以零
      const cci = md === 0 ? 0 : (tps[n - 1] - basis) / (0.015 * md);
      const sign = cci < CCI_OVERSOLD ? 1 : cci > CCI_OVERBOUGHT ? -1 : 0;
      out.push(
        result(
          'cci20',
          'CCI（20）',
          cci,
          sign,
          cci < CCI_OVERSOLD
            ? `CCI ${fmt(cci, 1)} < −100（超賣）`
            : cci > CCI_OVERBOUGHT
              ? `CCI ${fmt(cci, 1)} > 100（超買）`
              : `CCI ${fmt(cci, 1)} 在 ±100 常態區間內`,
        ),
      );
    }
  }

  // 5. ROC（12）— 12 日價格變化率；12 為動能類常用短中期參數
  {
    const period = 12;
    const need = period + 1;
    if (n < need) {
      out.push(notEnough('roc12', 'ROC（12）', need, n));
    } else {
      const base = closes[n - 1 - period];
      // 基準價為 0（理論上不應發生）時 ROC 定義為 0，避免除以零
      const roc = base === 0 ? 0 : (close / base - 1) * 100;
      out.push(
        result(
          'roc12',
          'ROC（12）',
          roc,
          Math.sign(roc),
          `ROC ${fmt(roc, 2)}% ${cmp(roc, 0)} 0（12 日變化率）`,
        ),
      );
    }
  }

  // 6. MOM（10）— 10 日價格差；10 為動能類常用短中期參數
  {
    const period = 10;
    const need = period + 1;
    if (n < need) {
      out.push(notEnough('mom10', 'MOM（10）', need, n));
    } else {
      const mom = close - closes[n - 1 - period];
      out.push(
        result(
          'mom10',
          'MOM（10）',
          mom,
          Math.sign(mom),
          `MOM ${fmt(mom)} ${cmp(mom, 0)} 0（10 日價格差）`,
        ),
      );
    }
  }

  // 7. Williams %R（14）— Williams 原始參數；−20/−80 為原始超買超賣線
  {
    const period = 14;
    if (n < period) {
      out.push(notEnough('willr14', 'Williams %R（14）', period, n));
    } else {
      const hh = highestHigh(candles, period) as number;
      const ll = lowestLow(candles, period) as number;
      // Williams 原始公式：(最高−收盤)/(最高−最低) × −100；
      // 零波動時定義為 −50（中性）
      const wr = hh === ll ? -50 : ((hh - close) / (hh - ll)) * -100;
      const sign = wr < WR_OVERSOLD ? 1 : wr > WR_OVERBOUGHT ? -1 : 0;
      out.push(
        result(
          'willr14',
          'Williams %R（14）',
          wr,
          sign,
          wr < WR_OVERSOLD
            ? `Williams %R ${fmt(wr, 1)} < −80（超賣）`
            : wr > WR_OVERBOUGHT
              ? `Williams %R ${fmt(wr, 1)} > −20（超買）`
              : `Williams %R ${fmt(wr, 1)} 在 −80～−20 中性區間`,
        ),
      );
    }
  }

  // 8. TSI（25,13）— Blau 原始參數；價格變化經 25/13 雙重 EMA 平滑後取比值
  {
    const long = 25;
    const short = 13;
    const need = long + short; // 38：變化值需 26 根 K 線，雙重平滑再疊 12
    if (n < need) {
      out.push(notEnough('tsi2513', 'TSI（25,13）', need, n));
    } else {
      const chg: number[] = [];
      const absChg: number[] = [];
      for (let i = 1; i < n; i++) {
        const d = closes[i] - closes[i - 1];
        chg.push(d);
        absChg.push(Math.abs(d));
      }
      const num = compact(emaSeries(chg, long));
      const den = compact(emaSeries(absChg, long));
      const num2 = compact(emaSeries(num, short));
      const den2 = compact(emaSeries(den, short));
      const last = num2[num2.length - 1];
      const lastAbs = den2[den2.length - 1];
      // 零波動時分母為 0，TSI 定義為 0（中性）
      const tsi = lastAbs === 0 ? 0 : (100 * last) / lastAbs;
      out.push(
        result(
          'tsi2513',
          'TSI（25,13）',
          tsi,
          Math.sign(tsi),
          `TSI ${fmt(tsi, 2)} ${cmp(tsi, 0)} 0（雙重平滑變化率）`,
        ),
      );
    }
  }

  // 9. PPO（12,26,9）— MACD 的百分比版本（Appel 式參數）；
  // 柱值（PPO 線 − 訊號線）> 0 為多頭動能
  {
    const fast = 12;
    const slow = 26;
    const signalP = 9;
    const need = slow + signalP - 1; // 34：PPO 線需 26 根，訊號線需 9 個 PPO 值
    if (n < need) {
      out.push(notEnough('ppo12269', 'PPO（12,26,9）', need, n));
    } else {
      const e12s = emaSeries(closes, fast);
      const e26s = emaSeries(closes, slow);
      const ppoLine: number[] = [];
      for (let i = slow - 1; i < n; i++) {
        const s = e26s[i] as number;
        // 慢線為 0（理論上不應發生）時該點取 0，避免除以零
        ppoLine.push(s === 0 ? 0 : (100 * ((e12s[i] as number) - s)) / s);
      }
      const signalLine = ema(ppoLine, signalP) as number;
      const hist = ppoLine[ppoLine.length - 1] - signalLine;
      out.push(
        result(
          'ppo12269',
          'PPO（12,26,9）',
          hist,
          Math.sign(hist),
          `PPO 柱 ${fmt(hist, 4)} ${cmp(hist, 0)} 0（百分比價格震盪）`,
        ),
      );
    }
  }

  // 10. BIAS（vs SMA20）— 收盤相對 20 日均線的乖離率；
  // 日線常用正負 5% 為過熱/超賣參考
  {
    const period = 20;
    if (n < period) {
      out.push(notEnough('bias20', 'BIAS（vs SMA20）', period, n));
    } else {
      const basis = sma(closes, period) as number;
      // 基準為 0（理論上不應發生）時乖離率定義為 0，避免除以零
      const bias = basis === 0 ? 0 : ((close - basis) / basis) * 100;
      const sign = bias < BIAS_OVERSOLD_PCT ? 1 : bias > BIAS_OVERBOUGHT_PCT ? -1 : 0;
      out.push(
        result(
          'bias20',
          'BIAS（vs SMA20）',
          bias,
          sign,
          bias < BIAS_OVERSOLD_PCT
            ? `乖離率 ${fmt(bias, 2)}% < −5%（超賣）`
            : bias > BIAS_OVERBOUGHT_PCT
              ? `乖離率 ${fmt(bias, 2)}% > 5%（過熱）`
              : `乖離率 ${fmt(bias, 2)}% 在 ±5% 中性區間`,
        ),
      );
    }
  }

  // 11. DPO（20）— 去趨勢價格震盪指標；標準位移 = 20/2 + 1 = 11 根。
  // 取「11 根前的收盤 − 當前 20 根收盤均線」：兩者皆為已確認資料，
  // 因果計算，不取未來值。
  {
    const period = 20;
    const shift = period / 2 + 1; // 11：標準 DPO 位移
    if (n < period) {
      out.push(notEnough('dpo20', 'DPO（20）', period, n));
    } else {
      const basis = sma(closes, period) as number;
      const dpo = closes[n - 1 - shift] - basis;
      out.push(
        result(
          'dpo20',
          'DPO（20）',
          dpo,
          Math.sign(dpo),
          `DPO ${fmt(dpo)} ${cmp(dpo, 0)} 0（11 根前收盤 ${fmt(closes[n - 1 - shift])} − SMA20 ${fmt(basis)}）`,
        ),
      );
    }
  }

  // 12. Ultimate Oscillator（7,14,28）— Williams 原始參數與 4:2:1 加權
  {
    const p1 = 7;
    const p2 = 14;
    const p3 = 28;
    const need = p3 + 1; // 29：BP/TR 變化值需 28 個
    if (n < need) {
      out.push(notEnough('uo71428', 'Ultimate Oscillator（7,14,28）', need, n));
    } else {
      const bp: number[] = [];
      const tr: number[] = [];
      for (let i = 1; i < n; i++) {
        const cur = candles[i];
        const prevC = candles[i - 1].c;
        // 買壓 BP = 收盤 − min(最低, 前收)；
        // 真實波幅 TR = max(最高, 前收) − min(最低, 前收)
        bp.push(cur.c - Math.min(cur.l, prevC));
        tr.push(Math.max(cur.h, prevC) - Math.min(cur.l, prevC));
      }
      const avg = (p: number): number => {
        const t = sumLast(tr, p);
        // 零波幅窗口（理論上不應發生）時該窗格取中性 50
        return t === 0 ? 50 : (100 * sumLast(bp, p)) / t;
      };
      // UO = (4×avg7 + 2×avg14 + avg28) / 7（Williams 原始加權，百分制）
      const uo = (4 * avg(p1) + 2 * avg(p2) + avg(p3)) / 7;
      const sign = uo < UO_OVERSOLD ? 1 : uo > UO_OVERBOUGHT ? -1 : 0;
      out.push(
        result(
          'uo71428',
          'Ultimate Oscillator（7,14,28）',
          uo,
          sign,
          uo < UO_OVERSOLD
            ? `UO ${fmt(uo, 1)} < 30（超賣）`
            : uo > UO_OVERBOUGHT
              ? `UO ${fmt(uo, 1)} > 70（超買）`
              : `UO ${fmt(uo, 1)} 在 30–70 中性區間`,
        ),
      );
    }
  }

  return out;
}
