'use server';

import { getCandlesWithReason } from './finnhub.actions';
import { binanceCandles, taiwanCandles } from '../candles/providers';
import { candleMarket } from '../candles/symbols';
import { CandleRequestError, createCandleCache, failure, fetchCandleJson, normalizeCandles } from '../candles/shared';
import type { CandleFailureReason, CandleResult, CandleSource, RawCandles as CandleArrays } from '../candles/types';

// Next 15's server-action transform rejects type re-exports; local aliases are erased correctly.
export type RawCandles = CandleArrays;

const barsCache = createCandleCache();
type PairResult = { pair: string | null; reason: CandleFailureReason | null };
const cryptoPairCache = new Map<string, { value: PairResult; freshUntil: number }>();
const pendingPairs = new Map<string, Promise<PairResult>>();

/** Existing test API; clears completed candle requests. */
export async function __resetAlpacaBarsCacheForTests(): Promise<void> {
    barsCache.clear();
}
export async function __resetCryptoPairCacheForTests(): Promise<void> {
    cryptoPairCache.clear();
    pendingPairs.clear();
}

type AlpacaBar = { t?: string; o?: number; h?: number; l?: number; c?: number; v?: number };

async function alpacaBars(symbol: string, days: number, crypto: boolean): Promise<CandleResult> {
    const source: CandleSource = { provider: 'alpaca', symbol, timeZone: crypto ? 'UTC' : 'America/New_York' };
    const key = process.env.ALPACA_API_KEY?.trim();
    const secret = process.env.ALPACA_API_SECRET?.trim();
    if (!key || !secret) return failure('missing-config', source);
    return barsCache.get(`alpaca:${crypto}:${symbol}:${days}`, source, async () => {
        const end = new Date();
        const start = new Date(end.getTime() - days * 86400_000);
        const path = crypto ? '/v1beta3/crypto/us/bars' : `/v2/stocks/${encodeURIComponent(symbol)}/bars`;
        const query = new URLSearchParams({
            ...(crypto ? { symbols: symbol } : { feed: 'iex' }),
            timeframe: '1Day', start: start.toISOString(), end: end.toISOString(), limit: '1000', sort: 'asc',
        });
        const data = await fetchCandleJson(`https://data.alpaca.markets${path}?${query}`, {
            'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret,
        }) as { bars?: AlpacaBar[] | Record<string, AlpacaBar[]> } | null;
        const bars = crypto ? (data?.bars as Record<string, AlpacaBar[]> | undefined)?.[symbol] : data?.bars;
        if (crypto && data?.bars && !Array.isArray(data.bars) && bars === undefined) {
            throw new CandleRequestError('no-data');
        }
        if (!Array.isArray(bars)) throw new CandleRequestError('api-error');
        return normalizeCandles(bars.map(bar => ({
            t: Date.parse(bar?.t ?? '') / 1000, o: bar?.o, h: bar?.h, l: bar?.l, c: bar?.c, v: bar?.v,
        })));
    });
}

/** Compatible low-level helpers: null on failure. */
export async function getAlpacaStockBars(symbol: string, days = 120): Promise<RawCandles | null> {
    const sym = (symbol || '').trim().toUpperCase();
    return sym ? (await alpacaBars(sym, days, false)).candles : null;
}
export async function getAlpacaCryptoBars(pair: string, days = 120): Promise<RawCandles | null> {
    const sym = (pair || '').trim().toUpperCase();
    return sym ? (await alpacaBars(sym, days, true)).candles : null;
}

async function resolveCryptoPair(id: string): Promise<PairResult> {
    const hit = cryptoPairCache.get(id);
    if (hit && hit.freshUntil > Date.now()) return hit.value;
    const pending = pendingPairs.get(id);
    if (pending) return pending;
    const request = (async (): Promise<PairResult> => {
        let value: PairResult;
        try {
            const token = process.env.COINGECKO_DEMO_API_KEY?.trim();
            const data = await fetchCandleJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}`,
                token ? { 'x-cg-demo-api-key': token } : {}) as { symbol?: string } | null;
            const symbol = data?.symbol?.trim().toUpperCase();
            value = symbol && /^[A-Z0-9]+$/.test(symbol)
                ? { pair: `${symbol}/USD`, reason: null }
                : { pair: null, reason: 'unsupported-symbol' };
        } catch (error) {
            value = { pair: null, reason: error instanceof CandleRequestError ? error.reason : 'api-error' };
        }
        if (cryptoPairCache.size >= 500) cryptoPairCache.delete(cryptoPairCache.keys().next().value!);
        cryptoPairCache.set(id, { value, freshUntil: Date.now() + (value.pair ? 24 * 3600_000 : 60_000) });
        return value;
    })();
    pendingPairs.set(id, request);
    try { return await request; } finally { pendingPairs.delete(id); }
}

/** Market-aware entrypoint with failure information for the indicator UI. */
export async function getDailyCandlesWithReason(symbol: string, days = 400): Promise<CandleResult> {
    const market = candleMarket(symbol);
    if (!Number.isInteger(days) || days < 1 || days > 1000) return failure('api-error');
    switch (market.kind) {
        case 'unsupported': return failure('unsupported-symbol');
        case 'binance': return binanceCandles(market.symbol, days);
        case 'taiwan': return taiwanCandles(market.symbol, days);
        case 'coingecko': {
            const resolved = await resolveCryptoPair(market.symbol);
            if (!resolved.pair) return failure(resolved.reason ?? 'unsupported-symbol');
            return alpacaBars(resolved.pair, days, true);
        }
        case 'international': return getCandlesWithReason(market.symbol, 'D', days);
        case 'us': {
            const primary = await alpacaBars(market.symbol, days, false);
            if (primary.candles) return primary;
            const fallback = await getCandlesWithReason(market.symbol, 'D', days);
            if (fallback.candles) return fallback;
            // A confirmed empty/unsupported response is more informative than an outage.
            const definite = (result: CandleResult) => result.reason === 'no-data' || result.reason === 'unsupported-symbol';
            if (definite(primary)) return primary;
            if (definite(fallback)) return fallback;
            return primary.reason === 'missing-config' ? fallback : primary;
        }
    }
}

/** Backward-compatible API for existing consumers. */
export async function getDailyCandles(symbol: string, days = 400): Promise<RawCandles | null> {
    return (await getDailyCandlesWithReason(symbol, days)).candles;
}
