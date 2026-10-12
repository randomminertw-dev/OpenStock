// lib/factors/scoring.ts
// Pure functions for the bullish/bearish factors dashboard.
// No 'use server' here: safe to import from both server actions and components.

export type FactorDirection = 'bullish' | 'bearish' | 'neutral';
export type FactorCategory = 'technical' | 'sentiment';
export type FactorVerdict = 'bullish' | 'bearish' | 'neutral';

export interface Factor {
    id: string;
    name: string;
    category: FactorCategory;
    direction: FactorDirection;
    /** -100 (strongly bearish) ~ 100 (strongly bullish) */
    score: number;
    weight: number;
    source: string;
    detail: string;
}

export interface FactorAssessment {
    symbol: string;
    factors: Factor[];
    compositeScore: number;
    verdict: FactorVerdict;
    bullishCount: number;
    bearishCount: number;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Indicator math (all pure; null when there isn't enough data)
// ---------------------------------------------------------------------------

export function computeSMA(values: number[], period: number): number | null {
    if (!values || values.length < period || period <= 0) return null;
    const slice = values.slice(values.length - period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(values: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const out = new Array<number>(values.length);
    let ema = values[0];
    for (let i = 0; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
        out[i] = ema;
    }
    return out;
}

export function computeEMA(values: number[], period: number): number | null {
    if (!values || values.length < period || period <= 0) return null;
    return emaSeries(values, period)[values.length - 1];
}

export function computeRSI(closes: number[], period = 14): number | null {
    if (!closes || closes.length < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

export function computeMACD(closes: number[]): { macd: number; signal: number; histogram: number } | null {
    if (!closes || closes.length < 35) return null;
    const ema12 = emaSeries(closes, 12);
    const ema26 = emaSeries(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = emaSeries(macdLine, 9);
    const n = closes.length - 1;
    const macd = macdLine[n];
    const signal = signalLine[n];
    return { macd, signal, histogram: macd - signal };
}

export function computeBollinger(
    closes: number[],
    period = 20,
    mult = 2,
): { upper: number; middle: number; lower: number } | null {
    const middle = computeSMA(closes, period);
    if (middle === null) return null;
    const slice = closes.slice(closes.length - period);
    const variance = slice.reduce((a, c) => a + (c - middle) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return { upper: middle + mult * sd, middle, lower: middle - mult * sd };
}

// ---------------------------------------------------------------------------
// Technical scoring
// ---------------------------------------------------------------------------

const TECH_SOURCE = 'Finnhub 日 K 線';

export function scoreTechnical(closes: number[]): Factor[] {
    if (!closes || closes.length === 0) return [];
    const factors: Factor[] = [];
    const last = closes[closes.length - 1];

    // RSI
    const rsi = computeRSI(closes, 14);
    if (rsi !== null) {
        const rsiText = rsi.toFixed(1);
        if (rsi < 30) {
            factors.push({ id: 'rsi', name: 'RSI 相對強弱指標', category: 'technical', direction: 'bullish', score: 60, weight: 3, source: TECH_SOURCE, detail: `RSI ${rsiText}，進入超賣區` });
        } else if (rsi > 70) {
            factors.push({ id: 'rsi', name: 'RSI 相對強弱指標', category: 'technical', direction: 'bearish', score: -60, weight: 3, source: TECH_SOURCE, detail: `RSI ${rsiText}，進入超買區` });
        } else if (rsi < 50) {
            factors.push({ id: 'rsi', name: 'RSI 相對強弱指標', category: 'technical', direction: 'bullish', score: 20, weight: 3, source: TECH_SOURCE, detail: `RSI ${rsiText}，動能中性偏弱` });
        } else {
            factors.push({ id: 'rsi', name: 'RSI 相對強弱指標', category: 'technical', direction: 'bearish', score: -20, weight: 3, source: TECH_SOURCE, detail: `RSI ${rsiText}，動能中性偏強` });
        }
    }

    // SMA50 (季線)
    const sma50 = computeSMA(closes, 50);
    if (sma50 !== null) {
        if (last > sma50) {
            factors.push({ id: 'sma50', name: '季線（50 日均線）', category: 'technical', direction: 'bullish', score: 40, weight: 2, source: TECH_SOURCE, detail: '收盤價站上季線' });
        } else if (last < sma50) {
            factors.push({ id: 'sma50', name: '季線（50 日均線）', category: 'technical', direction: 'bearish', score: -40, weight: 2, source: TECH_SOURCE, detail: '收盤價跌破季線' });
        }
    }

    // MACD histogram
    const macd = computeMACD(closes);
    if (macd !== null) {
        if (macd.histogram > 0) {
            factors.push({ id: 'macd', name: 'MACD 動能', category: 'technical', direction: 'bullish', score: 30, weight: 2, source: TECH_SOURCE, detail: 'MACD 柱狀為正，動能向上' });
        } else if (macd.histogram < 0) {
            factors.push({ id: 'macd', name: 'MACD 動能', category: 'technical', direction: 'bearish', score: -30, weight: 2, source: TECH_SOURCE, detail: 'MACD 柱狀為負，動能向下' });
        }
    }

    // Bollinger Bands
    const bb = computeBollinger(closes, 20, 2);
    if (bb !== null) {
        if (last < bb.lower) {
            factors.push({ id: 'bollinger', name: '布林通道', category: 'technical', direction: 'bullish', score: 40, weight: 2, source: TECH_SOURCE, detail: '收盤跌破下軌，短線超賣' });
        } else if (last > bb.upper) {
            factors.push({ id: 'bollinger', name: '布林通道', category: 'technical', direction: 'bearish', score: -40, weight: 2, source: TECH_SOURCE, detail: '收盤突破上軌，短線過熱' });
        }
    }

    return factors;
}

// ---------------------------------------------------------------------------
// News sentiment scoring (keyword heuristic, EN + ZH)
// ---------------------------------------------------------------------------

const POSITIVE_KEYWORDS = [
    'beat', 'upgraded', 'upgrade', 'record', 'surge', 'rally', 'outperform',
    'raised guidance', 'raised forecast', 'strong demand', 'breakthrough',
    '上調', '利多', '創新高', '優於預期', '超乎預期', '強勁需求', '突破',
];

const NEGATIVE_KEYWORDS = [
    'miss', 'missed', 'downgraded', 'downgrade', 'plunge', 'bearish', 'cut guidance',
    'lowered forecast', 'lawsuit', 'investigation', 'recall', 'layoff',
    '下調', '利空', '遜於預期', '不如預期', '虧損', '訴訟', '裁員',
];

const NEWS_SOURCE = 'Finnhub 新聞';
const NEWS_WEIGHT = 3;

function countKeywords(text: string, keywords: string[]): number {
    let count = 0;
    for (const kw of keywords) {
        if (text.includes(kw)) count++;
    }
    return count;
}

export function scoreNewsSentiment(articles: { headline?: string; summary?: string }[]): Factor[] {
    if (!articles || articles.length === 0) return [];
    let positive = 0;
    let negative = 0;
    for (const a of articles) {
        const text = `${a.headline ?? ''} ${a.summary ?? ''}`.toLowerCase();
        positive += countKeywords(text, POSITIVE_KEYWORDS.map((k) => k.toLowerCase()));
        negative += countKeywords(text, NEGATIVE_KEYWORDS.map((k) => k.toLowerCase()));
    }
    const raw = (positive - negative) * 15;
    const score = Math.max(-80, Math.min(80, raw));
    const direction: FactorDirection = score > 0 ? 'bullish' : score < 0 ? 'bearish' : 'neutral';
    return [
        {
            id: 'news-sentiment',
            name: '新聞情緒',
            category: 'sentiment',
            direction,
            score,
            weight: NEWS_WEIGHT,
            source: NEWS_SOURCE,
            detail: `近 ${articles.length} 篇報導：正向關鍵字 ${positive} 次，負向 ${negative} 次`,
        },
    ];
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

export function computeComposite(factors: Factor[]): { score: number; verdict: FactorVerdict } {
    let weighted = 0;
    let totalWeight = 0;
    for (const f of factors) {
        weighted += f.score * f.weight;
        totalWeight += f.weight;
    }
    const score = totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);
    const verdict: FactorVerdict = score > 20 ? 'bullish' : score < -20 ? 'bearish' : 'neutral';
    return { score, verdict };
}

export function buildAssessment(
    symbol: string,
    closes: number[] | null,
    articles: { headline?: string; summary?: string }[],
    updatedAt: string,
): FactorAssessment {
    const factors: Factor[] = [];
    if (closes && closes.length > 0) factors.push(...scoreTechnical(closes));
    factors.push(...scoreNewsSentiment(articles));
    const { score, verdict } = computeComposite(factors);
    return {
        symbol,
        factors,
        compositeScore: score,
        verdict,
        bullishCount: factors.filter((f) => f.direction === 'bullish').length,
        bearishCount: factors.filter((f) => f.direction === 'bearish').length,
        updatedAt,
    };
}
