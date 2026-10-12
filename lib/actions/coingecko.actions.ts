'use server';

import { coinIdFromSymbol } from '@/lib/coingecko';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const FETCH_TIMEOUT_MS = 8000;
const SEARCH_TTL_MS = 3600_000; // 1 hour
const PRICE_TTL_MS = 300_000; // 5 minutes (raised to ease CoinGecko rate limits)
const MAX_CACHE_ENTRIES = 500;
const RETRY_DELAY_MS = 1500;

// Optional free "demo" API key from coingecko.com (30 calls/min vs ~10-15
// without). Set COINGECKO_DEMO_API_KEY in Vercel env vars to use it.
const DEMO_API_KEY = process.env.COINGECKO_DEMO_API_KEY?.trim();

function coingeckoHeaders(): HeadersInit {
    return DEMO_API_KEY ? { 'x-cg-demo-api-key': DEMO_API_KEY } : {};
}

// Tiny per-instance TTL cache. CoinGecko's free tier is rate-limited
// (~10-30 calls/min), so search results and prices are cached aggressively.
const priceCache = new Map<string, { value: unknown; freshUntil: number }>();

async function cachedGet<T>(key: string, url: string, ttlMs: number): Promise<T | null> {
    const hit = priceCache.get(key);
    if (hit && hit.freshUntil > Date.now()) return hit.value as T;
    try {
        let res = await fetch(url, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: coingeckoHeaders(),
        });
        // CoinGecko's free tier rate-limits shared cloud IPs aggressively;
        // one delayed retry often succeeds where the first attempt got a 429.
        if (res.status === 429) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            res = await fetch(url, {
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                headers: coingeckoHeaders(),
            });
        }
        if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
        const data = (await res.json()) as T;
        if (priceCache.size >= MAX_CACHE_ENTRIES) priceCache.delete(priceCache.keys().next().value!);
        priceCache.set(key, { value: data, freshUntil: Date.now() + ttlMs });
        return data;
    } catch (e) {
        console.error('CoinGecko fetch failed:', url.split('?')[0], e);
        return null;
    }
}

export type CoinGeckoCoin = {
    id: string;
    symbol: string;
    name: string;
};

type CoinGeckoSearchResponse = {
    coins?: { id?: string; symbol?: string; name?: string }[];
};

/** Search CoinGecko for coins. Never throws; returns [] on failure. */
export async function searchCoins(query: string): Promise<CoinGeckoCoin[]> {
    const q = (query || '').trim();
    if (!q) return [];
    const data = await cachedGet<CoinGeckoSearchResponse>(
        `search:${q.toLowerCase()}`,
        `${COINGECKO_BASE}/search?query=${encodeURIComponent(q)}`,
        SEARCH_TTL_MS,
    );
    return (data?.coins || [])
        .filter((c) => c.id && c.name)
        .slice(0, 5)
        .map((c) => ({ id: c.id as string, symbol: (c.symbol || '').toUpperCase(), name: c.name as string }));
}

/** USD price + 24h change for a coin id. Never throws; returns null on failure. */
export async function getCoinPrice(coinId: string): Promise<{ price: number; changePercent: number } | null> {
    const id = (coinId || '').trim().toLowerCase();
    if (!id) return null;
    const data = await cachedGet<Record<string, { usd?: number; usd_24h_change?: number }>>(
        `price:${id}`,
        `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`,
        PRICE_TTL_MS,
    );
    const entry = data?.[id];
    if (!entry || typeof entry.usd !== 'number') return null;
    return {
        price: entry.usd,
        changePercent: typeof entry.usd_24h_change === 'number' ? entry.usd_24h_change : 0,
    };
}

/**
 * FinnhubQuote-compatible quote for a `CG:` symbol.
 * Fields Finnhub would provide (day high/low, prev close) are unavailable
 * from the simple price endpoint, so they are zeroed; callers should treat
 * 0 as "no data" (the UI already renders 0/undefined as '—').
 */
export async function getCryptoQuote(symbol: string) {
    const price = await getCoinPrice(coinIdFromSymbol(symbol));
    if (!price) return null;
    return {
        c: price.price,
        d: 0,
        dp: price.changePercent,
        h: 0,
        l: 0,
        o: 0,
        pc: 0,
        t: Math.floor(Date.now() / 1000),
    };
}
