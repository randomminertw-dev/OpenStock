/**
 * 7 support/resistance indicators with directional votes (+1 bullish / -1 bearish / 0 neutral).
 *
 * Voting rules (from the spec brief, followed verbatim):
 * - Fibonacci（60 日高低 61.8%）: 收盤 > 61.8% 回撤位 → +1；< → −1；否則 0
 * - Pivot（前日 HLC/3）:         收盤 > Pivot → +1；< → −1；否則 0
 * - CPR（前日中央樞紐區）:        收盤 > 上緣 → +1；< 下緣 → −1；區間內 → 0
 * - PriceChannel（55 日）:       位置 > 75% → −1（接近上緣壓力）；
 *                               < 25% → +1；否則 0
 * - MAEnvelope（SMA20＋2.5%）:   收盤 > 上緣 → −1；< 下緣 → +1；否則 0
 * - Camarilla（前日 R4）:        收盤 > R4 → −1（過熱）；< S4 → +1；否則 0
 * - Fractals:                   最近確認的分形為頂分形 → −1；
 *                               底分形 → +1；無 → 0（右側 2 根延遲確認）
 *
 * Value conventions (brief leaves these unspecified):
 * - Fibonacci 的 value 取 61.8% 回撤位價格 = 60 日最高 − 0.618 × (最高 − 最低)。
 * - Pivot 的 value 取前日 (H+L+C)/3；CPR 的 value 取上緣 TC（reason 同時給出下緣 BC）；
 *   Camarilla 的 value 取 R4（reason 同時給出 S4）。
 * - PriceChannel 的 value 取收盤在 55 日通道中的位置（%）；
 *   MAEnvelope 的 value 取上緣價格（SMA20 × 1.025）。
 * - Fractals 的 value 取最近確認分形的價格（頂分形取最高價、底分形取最低價）；
 *   無確認分形時 value 為 null 但 signal 為 0（中性投票，非資料不足）。
 *
 * Degenerate conventions (documented, kept neutral):
 * - 55 日最高最低價相等 → 通道位置無法定義 → value/signal 為 null。
 * - 同一根同時形成頂分形與底分形（極端大區間 K 線）→ 以頂分形（−1）為準。
 * - 分形比較採嚴格大於／小於（Bill Williams 定義）：等值不算分形。
 * - 「確認」僅使用右側已存在的 K 線：索引上限為 n−3，絕不使用未來資料。
 *
 * Pure functions only; never returns NaN/Infinity.
 * Insufficient data → { value: null, signal: null, reason: '資料不足…' }.
 */

import { highestHigh, lowestLow, sma } from './math';
import type { Candle, IndicatorResult, Signal } from './types';

/* ------------------------------------------------------------------ */
/* local helpers                                                      */
/* ------------------------------------------------------------------ */

/** Fibonacci 回撤比例（brief 指定 61.8%）。 */
const FIB_RATIO = 0.618;

/** PriceChannel 通道位置門檻（%）。 */
const CHANNEL_OVERBOUGHT = 75;
const CHANNEL_OVERSOLD = 25;

/** MAEnvelope 包絡半寬（SMA20 ± 2.5%）。 */
const ENVELOPE_PCT = 0.025;

/** Camarilla R4/S4 係數：R4 = C + (H−L) × 1.1/2。 */
const CAMARILLA_K = 1.1 / 2;

/** 分形方向：'top' = 頂分形（看跌），'bottom' = 底分形（看漲）。 */
type FractalDir = 'top' | 'bottom';

/**
 * Bill Williams 分形（5 根確認）：索引 i 為頂分形 ⇔
 * h[i] 嚴格大於 h[i−2..i+2] 其餘四根；底分形同理（l[i] 嚴格最小）。
 */
function isTopFractal(candles: Candle[], i: number): boolean {
  const h = candles[i].h;
  for (let j = i - 2; j <= i + 2; j++) {
    if (j !== i && !(h > candles[j].h)) return false;
  }
  return true;
}

function isBottomFractal(candles: Candle[], i: number): boolean {
  const l = candles[i].l;
  for (let j = i - 2; j <= i + 2; j++) {
    if (j !== i && !(l < candles[j].l)) return false;
  }
  return true;
}

/**
 * 最近確認的分形：由 n−3（右側 2 根延遲確認）往回掃到 2，
 * 第一個命中的即為最近確認者。無 → null。
 */
function latestConfirmedFractal(
  candles: Candle[],
): { dir: FractalDir; price: number } | null {
  const n = candles.length;
  for (let i = n - 3; i >= 2; i--) {
    const top = isTopFractal(candles, i);
    const bottom = isBottomFractal(candles, i);
    if (top) return { dir: 'top', price: candles[i].h };
    if (bottom) return { dir: 'bottom', price: candles[i].l };
  }
  return null;
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
    category: 'support',
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
  return { id, name, category: 'support', value, signal: vote(sign), reason };
}

/** Degenerate-data result: enough bars, but the data cannot define the indicator. */
function degenerate(id: string, name: string, reason: string): IndicatorResult {
  return { id, name, category: 'support', value: null, signal: null, reason };
}

/* ------------------------------------------------------------------ */
/* computeSupport                                                     */
/* ------------------------------------------------------------------ */

/**
 * Compute the 7 support/resistance indicators and their votes for the last candle.
 */
export function computeSupport(candles: Candle[]): IndicatorResult[] {
  const out: IndicatorResult[] = [];
  const n = candles.length;
  const last = n > 0 ? candles[n - 1] : null;

  // 1. Fibonacci（60 日高低 61.8%）—
  //    回撤位 = 60 日最高 − 0.618 × (最高 − 最低)；
  //    收盤 > 回撤位 → +1；< → −1；相等 → 0
  {
    const period = 60;
    if (n < period) {
      out.push(notEnough('fib60', 'Fibonacci（60 日高低 61.8%）', period, n));
    } else {
      const hi = highestHigh(candles, period) as number;
      const lo = lowestLow(candles, period) as number;
      const level = hi - FIB_RATIO * (hi - lo);
      const close = (last as Candle).c;
      const sign = close > level ? 1 : close < level ? -1 : 0;
      out.push(
        result(
          'fib60',
          'Fibonacci（60 日高低 61.8%）',
          level,
          sign,
          sign > 0
            ? `收盤 ${fmt(close)} 高於 61.8% 回撤位 ${fmt(level)}（守住回撤支撐）`
            : sign < 0
              ? `收盤 ${fmt(close)} 跌破 61.8% 回撤位 ${fmt(level)}（回撤轉弱）`
              : `收盤 ${fmt(close)} 恰在 61.8% 回撤位 ${fmt(level)}（多空拉鋸）`,
        ),
      );
    }
  }

  // 2. Pivot（前日 HLC/3）— 經典軸心點；
  //    收盤 > Pivot → +1；< → −1；相等 → 0
  {
    if (n < 2) {
      out.push(notEnough('pivot', 'Pivot（前日 HLC/3）', 2, n));
    } else {
      const p = candles[n - 2];
      const pivot = (p.h + p.l + p.c) / 3;
      const close = (last as Candle).c;
      const sign = close > pivot ? 1 : close < pivot ? -1 : 0;
      out.push(
        result(
          'pivot',
          'Pivot（前日 HLC/3）',
          pivot,
          sign,
          sign > 0
            ? `收盤 ${fmt(close)} 高於前日 Pivot ${fmt(pivot)}（站上軸心）`
            : sign < 0
              ? `收盤 ${fmt(close)} 低於前日 Pivot ${fmt(pivot)}（跌破軸心）`
              : `收盤 ${fmt(close)} 恰在前日 Pivot ${fmt(pivot)}（軸心拉鋸）`,
        ),
      );
    }
  }

  // 3. CPR（前日中央樞紐區）— 中央樞紐區間：
  //    P = (H+L+C)/3, BC = (H+L)/2, TC = 2P − BC；
  //    收盤 > 上緣 TC → +1；< 下緣 BC → −1；區間內（含邊界）→ 0
  {
    if (n < 2) {
      out.push(notEnough('cpr', 'CPR（前日中央樞紐區）', 2, n));
    } else {
      const p = candles[n - 2];
      const pivot = (p.h + p.l + p.c) / 3;
      const bc = (p.h + p.l) / 2;
      const tc = 2 * pivot - bc;
      const close = (last as Candle).c;
      const sign = close > tc ? 1 : close < bc ? -1 : 0;
      out.push(
        result(
          'cpr',
          'CPR（前日中央樞紐區）',
          tc,
          sign,
          sign > 0
            ? `收盤 ${fmt(close)} 高於 CPR 上緣 ${fmt(tc)}（突破樞紐區）`
            : sign < 0
              ? `收盤 ${fmt(close)} 低於 CPR 下緣 ${fmt(bc)}（跌破樞紐區）`
              : `收盤 ${fmt(close)} 位於 CPR 區間 ${fmt(bc)}–${fmt(tc)} 內（樞紐區整理）`,
        ),
      );
    }
  }

  // 4. PriceChannel（55 日）— 收盤在 55 日高低通道中的位置（%）：
  //    > 75% → −1（接近上緣壓力）；< 25% → +1；否則 0
  {
    const period = 55;
    if (n < period) {
      out.push(notEnough('pricechannel55', 'PriceChannel（55 日）', period, n));
    } else {
      const hi = highestHigh(candles, period) as number;
      const lo = lowestLow(candles, period) as number;
      const range = hi - lo;
      if (!(range > 0)) {
        out.push(
          degenerate(
            'pricechannel55',
            'PriceChannel（55 日）',
            '退化資料：55 日最高最低價相等，通道位置無法定義',
          ),
        );
      } else {
        const close = (last as Candle).c;
        const pos = (100 * (close - lo)) / range;
        const sign = pos > CHANNEL_OVERBOUGHT ? -1 : pos < CHANNEL_OVERSOLD ? 1 : 0;
        out.push(
          Number.isFinite(pos)
            ? result(
                'pricechannel55',
                'PriceChannel（55 日）',
                pos,
                sign,
                sign > 0
                  ? `通道位置 ${fmt(pos, 1)}% < ${CHANNEL_OVERSOLD}%（接近下緣支撐）`
                  : sign < 0
                    ? `通道位置 ${fmt(pos, 1)}% > ${CHANNEL_OVERBOUGHT}%（接近上緣壓力）`
                    : `通道位置 ${fmt(pos, 1)}%（通道中段）`,
              )
            : degenerate(
                'pricechannel55',
                'PriceChannel（55 日）',
                '退化資料：通道位置計算異常',
              ),
        );
      }
    }
  }

  // 5. MAEnvelope（SMA20＋2.5%）— 移動平均包絡：
  //    上緣 = SMA20 × 1.025，下緣 = SMA20 × 0.975；
  //    收盤 > 上緣 → −1；< 下緣 → +1；否則 0
  {
    const period = 20;
    const avg = sma(
      candles.map((c) => c.c),
      period,
    );
    if (n < period || avg === null) {
      out.push(notEnough('maenvelope20', 'MAEnvelope（SMA20＋2.5%）', period, n));
    } else {
      const upper = avg * (1 + ENVELOPE_PCT);
      const lower = avg * (1 - ENVELOPE_PCT);
      const close = (last as Candle).c;
      const sign = close > upper ? -1 : close < lower ? 1 : 0;
      out.push(
        Number.isFinite(upper) && Number.isFinite(lower)
          ? result(
              'maenvelope20',
              'MAEnvelope（SMA20＋2.5%）',
              upper,
              sign,
              sign > 0
                ? `收盤 ${fmt(close)} 低於包絡下緣 ${fmt(lower)}（超跌反彈機會）`
                : sign < 0
                  ? `收盤 ${fmt(close)} 高於包絡上緣 ${fmt(upper)}（乖離過大）`
                  : `收盤 ${fmt(close)} 位於包絡 ${fmt(lower)}–${fmt(upper)} 內`,
            )
          : notEnough('maenvelope20', 'MAEnvelope（SMA20＋2.5%）', period, n),
      );
    }
  }

  // 6. Camarilla（前日 R4）— Camarilla 軸心：
  //    R4 = C + (H−L) × 1.1/2, S4 = C − (H−L) × 1.1/2；
  //    收盤 > R4 → −1（過熱）；< S4 → +1；否則 0
  {
    if (n < 2) {
      out.push(notEnough('camarilla', 'Camarilla（前日 R4）', 2, n));
    } else {
      const p = candles[n - 2];
      const range = p.h - p.l;
      const r4 = p.c + range * CAMARILLA_K;
      const s4 = p.c - range * CAMARILLA_K;
      const close = (last as Candle).c;
      const sign = close > r4 ? -1 : close < s4 ? 1 : 0;
      out.push(
        Number.isFinite(r4) && Number.isFinite(s4)
          ? result(
              'camarilla',
              'Camarilla（前日 R4）',
              r4,
              sign,
              sign > 0
                ? `收盤 ${fmt(close)} 低於前日 S4 ${fmt(s4)}（超賣反彈機會）`
                : sign < 0
                  ? `收盤 ${fmt(close)} 高於前日 R4 ${fmt(r4)}（過熱）`
                  : `收盤 ${fmt(close)} 位於前日 S4 ${fmt(s4)}–R4 ${fmt(r4)} 內`,
            )
          : notEnough('camarilla', 'Camarilla（前日 R4）', 2, n),
      );
    }
  }

  // 7. Fractals — Bill Williams 分形（5 根確認，右側 2 根延遲）：
  //    最近確認的分形為頂分形 → −1；底分形 → +1；無 → 0
  {
    if (n < 5) {
      out.push(notEnough('fractals', 'Fractals', 5, n));
    } else {
      const f = latestConfirmedFractal(candles);
      out.push(
        f === null
          ? result(
              'fractals',
              'Fractals',
              null,
              0,
              '無已確認的分形（中性）',
            )
          : result(
              'fractals',
              'Fractals',
              f.price,
              f.dir === 'top' ? -1 : 1,
              f.dir === 'top'
                ? `最近確認為頂分形 ${fmt(f.price)}（壓力成形）`
                : `最近確認為底分形 ${fmt(f.price)}（支撐成形）`,
            ),
      );
    }
  }

  return out;
}
