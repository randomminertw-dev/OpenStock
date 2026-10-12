/**
 * 10 volume indicators with directional votes (+1 bullish / -1 bearish / 0 neutral).
 *
 * Voting rules (from the spec brief, followed verbatim):
 * - VOL（vs 20 日均量）: 量增＋收漲 → +1；量增＋收跌 → −1；否則 0
 * - OBV（vs EMA20）:    OBV > EMA20 → +1；< → −1；否則 0
 * - VWAP:               N/A（需盤中分時資料）→ 恆為 null
 * - MFI（14）:          < 20 → +1（超賣）；> 80 → −1（過熱）；否則 0
 * - CMF（20）:          > 0 → +1（資金流入）；< 0 → −1（資金流出）；否則 0
 * - AD（vs EMA20）:     AD > EMA20 → +1；< → −1；否則 0
 * - PVT（vs EMA20）:    PVT > EMA20 → +1；< → −1；否則 0
 * - PVO（12,26,9）:     PVO > 0 → +1；< 0 → −1；否則 0
 * - EMV（14）:          EMV > 0 → +1；< 0 → −1；否則 0
 * - VolumeProfile:      N/A（需價量分布資料）→ 恆為 null
 *
 * Value conventions (brief leaves these unspecified):
 * - VOL 的 value 取「量能佔比」= 當根成交量 ÷ 20 日均量 × 100（%）；
 *   100 = 恰為均量，> 100 = 量增，方便面板呈現。
 * - MFI 的 value 為 0–100 指數；CMF 的 value 為 −1~+1 原始值；
 *   PVO 的 value 以百分比表示（%）。
 * - OBV / AD / PVT / EMV 的 value 為原始讀數（累積值或價格單位）。
 *
 * Degenerate conventions (documented, kept neutral):
 * - 收盤與開盤相等 → 既非收漲亦非收跌（VOL 投票為 0）。
 * - MFI 視窗內正負資金流皆為 0（價格完全不動）→ MFI = 50（中性）。
 * - EMV 單期計算遇成交量為 0 或最高最低價相等 → 該期 EMV 視為 0。
 * - CMF 的 20 日總成交量為 0，或 PVO 的 EMA26（成交量）為 0 → 資料不足（null）。
 *
 * Pure functions only; never returns NaN/Infinity.
 * Insufficient data → { value: null, signal: null, reason: '資料不足…' }.
 */

import { ema, sma } from './math';
import type { Candle, IndicatorResult, Signal } from './types';

/* ------------------------------------------------------------------ */
/* local series helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * Money Flow Multiplier（CLV，收盤位置值）: ((c−l) − (h−c)) / (h−l)。
 * 最高最低價相等時（無波動）定義為 0，避免除零。
 */
function moneyFlowMultiplier(c: Candle): number {
  const range = c.h - c.l;
  if (!(range > 0)) return 0;
  return ((c.c - c.l) - (c.h - c.c)) / range;
}

/** Typical price = (h + l + c) / 3. */
function typicalPrice(c: Candle): number {
  return (c.h + c.l + c.c) / 3;
}

/**
 * On-Balance Volume series. obv[0] = 0; each subsequent bar adds (or
 * subtracts) its volume depending on the close direction.
 */
function obvSeries(candles: Candle[]): number[] {
  const out: number[] = new Array(candles.length);
  out[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].c - candles[i - 1].c;
    out[i] = out[i - 1] + (diff > 0 ? candles[i].v : diff < 0 ? -candles[i].v : 0);
  }
  return out;
}

/**
 * Accumulation/Distribution line series. ad[0] = CLV × volume of the
 * first bar (Chaikin convention); each subsequent bar accumulates.
 */
function adSeries(candles: Candle[]): number[] {
  const out: number[] = new Array(candles.length);
  out[0] = moneyFlowMultiplier(candles[0]) * candles[0].v;
  for (let i = 1; i < candles.length; i++) {
    out[i] = out[i - 1] + moneyFlowMultiplier(candles[i]) * candles[i].v;
  }
  return out;
}

/**
 * Price Volume Trend series. pvt[0] = 0; each bar adds
 * volume × (close − prevClose) / prevClose. A zero previous close
 * contributes 0 (degenerate protection).
 */
function pvtSeries(candles: Candle[]): number[] {
  const out: number[] = new Array(candles.length);
  out[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    const roc = prev === 0 ? 0 : (candles[i].c - prev) / prev;
    out[i] = out[i - 1] + candles[i].v * roc;
  }
  return out;
}

/**
 * Money Flow Index（14）: 100 − 100 / (1 + 正資金流14日和 / 負資金流14日和)。
 * 視窗內正負資金流皆為 0（價格完全不動）→ 回傳 50（中性約定）。
 * Null when candles.length < period + 1.
 */
function mfi(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  let positive = 0;
  let negative = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tp = typicalPrice(candles[i]);
    const prevTp = typicalPrice(candles[i - 1]);
    const rmf = tp * candles[i].v;
    if (tp > prevTp) positive += rmf;
    else if (tp < prevTp) negative += rmf;
  }
  if (positive === 0 && negative === 0) return 50; // 退化約定：完全無價格變動
  if (negative === 0) return 100;
  if (positive === 0) return 0;
  return 100 - 100 / (1 + positive / negative);
}

/**
 * Chaikin Money Flow（20）: Σ(資金流乘數 × 成交量) / Σ(成交量)，20 日視窗。
 * 視窗總成交量為 0 → null（退化保護）。
 */
function cmf(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  let mfvSum = 0;
  let volSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    mfvSum += moneyFlowMultiplier(candles[i]) * candles[i].v;
    volSum += candles[i].v;
  }
  if (!(volSum > 0)) return null;
  return mfvSum / volSum;
}

/**
 * Single-period Ease of Movement values (length n − 1):
 *   distanceMoved = midpoint − prevMidpoint,  midpoint = (h + l) / 2
 *   boxRatio = volume / (h − l)
 *   EMV = distanceMoved / boxRatio
 * 成交量為 0 或最高最低價相等時該期 EMV 視為 0（退化保護）。
 */
function emvSinglePeriods(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const mid = (candles[i].h + candles[i].l) / 2;
    const prevMid = (candles[i - 1].h + candles[i - 1].l) / 2;
    const range = candles[i].h - candles[i].l;
    const v = candles[i].v;
    if (!(range > 0) || !(v > 0)) {
      out.push(0);
      continue;
    }
    out.push(((mid - prevMid) * range) / v);
  }
  return out;
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
    category: 'volume',
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
  return { id, name, category: 'volume', value, signal: vote(sign), reason };
}

/** N/A result for indicators that require data this source cannot provide. */
function notAvailable(id: string, name: string, reason: string): IndicatorResult {
  return { id, name, category: 'volume', value: null, signal: null, reason };
}

/* ------------------------------------------------------------------ */
/* computeVolume                                                      */
/* ------------------------------------------------------------------ */

/** MFI 超賣／過熱門檻（標準參數） */
const MFI_OVERSOLD = 20;
const MFI_OVERBOUGHT = 80;

/**
 * Compute the 10 volume indicators and their votes for the last candle.
 * VWAP and VolumeProfile are always N/A: the data source provides daily
 * OHLCV only, with no intraday bars (VWAP) and no per-price-level volume
 * distribution (VolumeProfile).
 */
export function computeVolume(candles: Candle[]): IndicatorResult[] {
  const out: IndicatorResult[] = [];
  const n = candles.length;
  const volumes = candles.map((c) => c.v);
  const last = n > 0 ? candles[n - 1] : null;

  // 1. VOL（vs 20 日均量）— 當根成交量 ÷ 20 日均量 × 100（%）；
  //    量增（> 均量）＋收漲（收盤 > 開盤）→ +1；
  //    量增＋收跌（收盤 < 開盤）→ −1；否則 0
  {
    const period = 20;
    const avg = sma(volumes, period);
    out.push(
      n < period || avg === null
        ? notEnough('vol20', 'VOL（vs 20 日均量）', period, n)
        : !(avg > 0)
          ? notEnough('vol20', 'VOL（vs 20 日均量）', period, n)
          : (() => {
              const ratio = (100 * (last as Candle).v) / avg;
              const volUp = (last as Candle).v > avg;
              const up = (last as Candle).c > (last as Candle).o;
              const down = (last as Candle).c < (last as Candle).o;
              const sign = volUp && up ? 1 : volUp && down ? -1 : 0;
              return result(
                'vol20',
                'VOL（vs 20 日均量）',
                ratio,
                sign,
                sign > 0
                  ? `量能 ${fmt(ratio, 1)}%（量增）且收漲 ${fmt((last as Candle).o)}→${fmt((last as Candle).c)}`
                  : sign < 0
                    ? `量能 ${fmt(ratio, 1)}%（量增）且收跌 ${fmt((last as Candle).o)}→${fmt((last as Candle).c)}`
                    : `量能 ${fmt(ratio, 1)}%（${volUp ? '量增但收平' : '未量增'}）`,
              );
            })(),
    );
  }

  // 2. OBV（vs EMA20）— Joseph Granville 能量潮；
  //    OBV > 其 EMA20 → +1；< → −1；相等 → 0
  {
    const period = 20;
    if (n < period) {
      out.push(notEnough('obv20', 'OBV（vs EMA20）', period, n));
    } else {
      const series = obvSeries(candles);
      const e = ema(series, period) as number;
      const v = series[n - 1];
      const sign = v > e ? 1 : v < e ? -1 : 0;
      out.push(
        Number.isFinite(v) && Number.isFinite(e)
          ? result(
              'obv20',
              'OBV（vs EMA20）',
              v,
              sign,
              sign > 0
                ? `OBV ${fmt(v, 0)} 高於其 EMA20 ${fmt(e, 0)}（買盤動能）`
                : sign < 0
                  ? `OBV ${fmt(v, 0)} 低於其 EMA20 ${fmt(e, 0)}（賣盤動能）`
                  : `OBV ${fmt(v, 0)} 與其 EMA20 ${fmt(e, 0)} 持平`,
            )
          : notEnough('obv20', 'OBV（vs EMA20）', period, n),
      );
    }
  }

  // 3. VWAP — N/A：VWAP 需盤中分時價量資料加權計算，
  //    資料源僅提供日線 K 線，恆為 null
  out.push(
    notAvailable(
      'vwap',
      'VWAP',
      'N/A：VWAP 需盤中分時價量資料，目前僅有日線 K 線，無法計算',
    ),
  );

  // 4. MFI（14）— 資金流量指數；< 20 超賣 → +1；> 80 過熱 → −1；否則 0
  {
    const period = 14;
    const need = period + 1; // 14 期資金流需 15 根 K 線
    const v = mfi(candles, period);
    out.push(
      n < need || v === null
        ? notEnough('mfi14', 'MFI（14）', need, n)
        : result(
            'mfi14',
            'MFI（14）',
            v,
            v < MFI_OVERSOLD ? 1 : v > MFI_OVERBOUGHT ? -1 : 0,
            v < MFI_OVERSOLD
              ? `MFI ${fmt(v, 1)} < ${MFI_OVERSOLD}（超賣，資金流出枯竭）`
              : v > MFI_OVERBOUGHT
                ? `MFI ${fmt(v, 1)} > ${MFI_OVERBOUGHT}（過熱，資金追價）`
                : `MFI ${fmt(v, 1)} 位於 ${MFI_OVERSOLD}–${MFI_OVERBOUGHT} 中性區間`,
          ),
    );
  }

  // 5. CMF（20）— Marc Chaikin 資金流量；> 0 資金流入 → +1；
  //    < 0 資金流出 → −1；否則 0
  {
    const period = 20;
    const v = cmf(candles, period);
    out.push(
      v === null
        ? notEnough('cmf20', 'CMF（20）', period, n)
        : result(
            'cmf20',
            'CMF（20）',
            v,
            v > 0 ? 1 : v < 0 ? -1 : 0,
            v > 0
              ? `CMF ${fmt(v, 3)} > 0（資金淨流入）`
              : v < 0
                ? `CMF ${fmt(v, 3)} < 0（資金淨流出）`
                : `CMF ${fmt(v, 3)} = 0（資金進出平衡）`,
          ),
    );
  }

  // 6. AD（vs EMA20）— Marc Chaikin 累積／派發線；
  //    AD > 其 EMA20 → +1；< → −1；相等 → 0
  {
    const period = 20;
    if (n < period) {
      out.push(notEnough('ad20', 'AD（vs EMA20）', period, n));
    } else {
      const series = adSeries(candles);
      const e = ema(series, period) as number;
      const v = series[n - 1];
      const sign = v > e ? 1 : v < e ? -1 : 0;
      out.push(
        Number.isFinite(v) && Number.isFinite(e)
          ? result(
              'ad20',
              'AD（vs EMA20）',
              v,
              sign,
              sign > 0
                ? `AD ${fmt(v, 0)} 高於其 EMA20 ${fmt(e, 0)}（吸籌）`
                : sign < 0
                  ? `AD ${fmt(v, 0)} 低於其 EMA20 ${fmt(e, 0)}（派發）`
                  : `AD ${fmt(v, 0)} 與其 EMA20 ${fmt(e, 0)} 持平`,
            )
          : notEnough('ad20', 'AD（vs EMA20）', period, n),
      );
    }
  }

  // 7. PVT（vs EMA20）— 價量趨勢指標；
  //    PVT > 其 EMA20 → +1；< → −1；相等 → 0
  {
    const period = 20;
    if (n < period) {
      out.push(notEnough('pvt20', 'PVT（vs EMA20）', period, n));
    } else {
      const series = pvtSeries(candles);
      const e = ema(series, period) as number;
      const v = series[n - 1];
      const sign = v > e ? 1 : v < e ? -1 : 0;
      out.push(
        Number.isFinite(v) && Number.isFinite(e)
          ? result(
              'pvt20',
              'PVT（vs EMA20）',
              v,
              sign,
              sign > 0
                ? `PVT ${fmt(v, 0)} 高於其 EMA20 ${fmt(e, 0)}（價量配合上漲）`
                : sign < 0
                  ? `PVT ${fmt(v, 0)} 低於其 EMA20 ${fmt(e, 0)}（價量配合下跌）`
                  : `PVT ${fmt(v, 0)} 與其 EMA20 ${fmt(e, 0)} 持平`,
            )
          : notEnough('pvt20', 'PVT（vs EMA20）', period, n),
      );
    }
  }

  // 8. PVO（12,26,9）— 成交量百分比震盪指標：
  //    (EMA12(量) − EMA26(量)) / EMA26(量) × 100；
  //    > 0 → +1；< 0 → −1；否則 0
  //    （訊號線 9 不參與投票，僅參數標示）
  {
    const need = 26; // EMA26 需 26 根
    if (n < need) {
      out.push(notEnough('pvo12269', 'PVO（12,26,9）', need, n));
    } else {
      const e12 = ema(volumes, 12) as number;
      const e26 = ema(volumes, 26) as number;
      out.push(
        !(e26 > 0)
          ? notEnough('pvo12269', 'PVO（12,26,9）', need, n)
          : (() => {
              const v = (100 * (e12 - e26)) / e26;
              const sign = v > 0 ? 1 : v < 0 ? -1 : 0;
              return Number.isFinite(v)
                ? result(
                    'pvo12269',
                    'PVO（12,26,9）',
                    v,
                    sign,
                    sign > 0
                      ? `PVO ${fmt(v, 2)}% > 0（短期均量高於長期均量）`
                      : sign < 0
                        ? `PVO ${fmt(v, 2)}% < 0（短期均量低於長期均量）`
                        : `PVO ${fmt(v, 2)}% = 0（均量持平）`,
                  )
                : notEnough('pvo12269', 'PVO（12,26,9）', need, n);
            })(),
      );
    }
  }

  // 9. EMV（14）— Richard Arms 簡易波動指標：14 期單期 EMV 的 SMA；
  //    > 0 → +1（上漲輕鬆）；< 0 → −1；否則 0
  {
    const period = 14;
    const need = period + 1; // 14 個單期 EMV 需 15 根 K 線
    if (n < need) {
      out.push(notEnough('emv14', 'EMV（14）', need, n));
    } else {
      const v = sma(emvSinglePeriods(candles), period);
      out.push(
        v === null
          ? notEnough('emv14', 'EMV（14）', need, n)
          : result(
              'emv14',
              'EMV（14）',
              v,
              v > 0 ? 1 : v < 0 ? -1 : 0,
              v > 0
                ? `EMV ${fmt(v, 4)} > 0（上漲阻力小）`
                : v < 0
                  ? `EMV ${fmt(v, 4)} < 0（下跌阻力小）`
                  : `EMV ${fmt(v, 4)} = 0（多空拉鋸）`,
            ),
      );
    }
  }

  // 10. VolumeProfile — N/A：需價格區間的成交量分布（POC／價值區）資料，
  //     資料源僅提供日線 K 線，恆為 null
  out.push(
    notAvailable(
      'volumeprofile',
      'VolumeProfile',
      'N/A：Volume Profile 需價量分布資料（各價格區間的成交量），目前僅有日線 K 線，無法計算',
    ),
  );

  return out;
}
