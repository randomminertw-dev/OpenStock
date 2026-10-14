'use server';

import { getDateRange, validateArticle, formatArticle } from '@/lib/utils';
import { POPULAR_STOCKS } from '@/lib/constants';
import { cache } from 'react';
import { QUOTE_TTL_SECONDS } from '@/lib/market-data';
import { hasFinnhubQuotes } from '@/lib/markets';
import { getSession } from '@/lib/better-auth/auth';
import { CandleRequestError, createCandleCache, failure, normalizeCandles } from '../candles/shared';
import type { CandleResult, CandleSource } from '../candles/types';
import { getTaiwanQuote, getTaiwanSecurity, searchTaiwanSecurities } from '@/lib/taiwan/reads';
import { parseTaiwanKey, TAIWAN_CODE_REGEX } from '@/lib/taiwan/symbols';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
// Key pool: each free key has its own 60 req/min, so N keys = N x the quota. Rotated per request.
const getFinnhubKeys = () =>
    (process.env.FINNHUB_API_KEYS || process.env.NEXT_PUBLIC_FINNHUB_API_KEY || process.env.FINNHUB_API_KEY || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
let nextKeyIndex = 0;
const FETCH_TIMEOUT_MS = 5000;
// Finnhub stalls bursts of parallel requests from one key (measured: 4 at once -> most hang),
// so calls are queued. ponytail: per-instance limiter; a shared queue (Redis) if instances multiply.
const MAX_IN_FLIGHT_PER_KEY = 2;
const MAX_CACHE_ENTRIES = 1000;
const FAILURE_TTL_MS = 60_000;
// Quotes are shared across everyone looking at a symbol: Finnhub cost scales with symbols, not users
const LIVE_QUOTE_TTL = QUOTE_TTL_SECONDS;
// Long-lived responses also go to the Next data cache, which Vercel shares across all instances
const SHARED_CACHE_MIN_TTL = 60;

type FinnhubQuote = {
    c?: number;  // current
    d?: number;  // change
    dp?: number; // change %
    h?: number;  // day high
    l?: number;  // day low
    o?: number;  // open
    pc?: number; // previous close
    t?: number;  // unix time of the last trade
};

type FinnhubCompanyProfile = {
    currency?: string;
    exchange?: string;
    logo?: string;
    marketCapitalization?: number;
    name?: string;
    ticker?: string;
    finnhubIndustry?: string;
    weburl?: string;
};

type SearchStockCandidate = FinnhubSearchResult & {
    __exchange?: string;
};

const FINNHUB_EXCHANGE_SUFFIXES = new Set([
    'AS', 'AT', 'AX', 'BA', 'BK', 'BO', 'BR', 'CO', 'DE', 'F', 'HE', 'HK',
    'IL', 'IS', 'JK', 'JO', 'KL', 'KQ', 'KS', 'L', 'LS', 'MC', 'MI', 'MX',
    'NS', 'NZ', 'OL', 'PA', 'PR', 'SA', 'SI', 'SS', 'ST', 'SW', 'SZ', 'T',
    'TA', 'TO', 'TW', 'TWO', 'V', 'VI', 'WA',
]);

// Thrown instead of calling Finnhub while an endpoint is in its failure cool-down; not worth logging again.
class RecentFailure extends Error {}
const logFailure = (what: string, symbol: string, e: unknown) => {
    if (!(e instanceof RecentFailure)) console.error(`Error fetching ${what} for`, symbol, e);
};

let activeRequests = 0;
const waitingForSlot: (() => void)[] = [];
const inFlight = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { value: unknown; freshUntil: number; failed?: boolean }>();

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
    const keys = getFinnhubKeys();
    if (activeRequests >= MAX_IN_FLIGHT_PER_KEY * Math.max(1, keys.length)) await new Promise<void>((resolve) => waitingForSlot.push(resolve));
    activeRequests++;
    try {
        return await run();
    } finally {
        activeRequests--;
        waitingForSlot.shift()?.();
    }
}

// The token travels in a header, so cache keys are the same whichever key served them.
// On 429 the next key in the pool gets a turn.
async function fetchWithKeyPool(url: string, ttl: number) {
    const keys = getFinnhubKeys();
    if (keys.length === 0) throw new Error('No Finnhub API key configured (FINNHUB_API_KEYS)');
    let res: Response | null = null;
    for (let attempt = 0; attempt < keys.length; attempt++) {
        const key = keys[nextKeyIndex++ % keys.length];
        res = await fetch(url, {
            headers: { 'X-Finnhub-Token': key },
            // Without a timeout a stalled Finnhub socket holds the page for Node's 300s default
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            ...(ttl >= SHARED_CACHE_MIN_TTL ? { next: { revalidate: ttl } } : { cache: 'no-store' as const }),
        });
        if (res.status !== 429) break;
    }
    return res!;
}

// One network call per URL at a time, however many pages ask for it
function request<T>(url: string, ttl = 0): Promise<T> {
    let pending = inFlight.get(url) as Promise<T> | undefined;
    if (!pending) {
        pending = withSlot(async () => {
            const res = await fetchWithKeyPool(url, ttl);
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Fetch failed ${res.status}: ${text}`);
            }
            return (await res.json()) as T;
        }).finally(() => inFlight.delete(url));
        inFlight.set(url, pending);
    }
    return pending;
}

// Stale-while-revalidate: after the first fetch nobody waits on Finnhub; expired entries
// are served instantly and refreshed in the background.
async function fetchJSON<T>(url: string, revalidateSeconds = 0): Promise<T> {
    if (!revalidateSeconds) return request<T>(url);

    const store = (entry: { value: unknown; freshUntil: number; failed?: boolean }) => {
        if (responseCache.size >= MAX_CACHE_ENTRIES) responseCache.delete(responseCache.keys().next().value!);
        responseCache.set(url, entry);
    };
    const refresh = () => request<T>(url, revalidateSeconds).then(
        (value) => {
            store({ value, freshUntil: Date.now() + revalidateSeconds * 1000 });
            return value;
        },
        (error) => {
            // A stalling endpoint fails fast for a minute instead of costing every visitor the full timeout.
            // A stale value keeps being served, but its next refresh also waits out the cool-down.
            const existing = responseCache.get(url);
            store(existing && !existing.failed
                ? { value: existing.value, freshUntil: Date.now() + FAILURE_TTL_MS }
                : { value: null, freshUntil: Date.now() + FAILURE_TTL_MS, failed: true });
            throw error;
        },
    );

    const hit = responseCache.get(url);
    if (!hit || (hit.failed && hit.freshUntil < Date.now())) return refresh();
    if (hit.failed) throw new RecentFailure(`Finnhub request failed recently: ${url.split('?')[0]}`);
    if (hit.freshUntil < Date.now()) refresh().catch(() => { /* keep serving the stale value */ });
    return hit.value as T;
}

function getExchangeLabel(symbol: string, exchange?: string) {
    if (exchange?.trim()) {
        return exchange.trim();
    }

    const parts = symbol.split('.');
    const suffix = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';

    if (!suffix) {
        return 'US';
    }

    return FINNHUB_EXCHANGE_SUFFIXES.has(suffix) ? suffix : 'US';
}

export async function getQuote(symbol: string, revalidateSeconds = 0) {
    try {
        const url = `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}`;
        // Real-time by default; shared views pass a short cache to stay inside Finnhub's 60 req/min
        return await fetchJSON<FinnhubQuote>(url, revalidateSeconds);
    } catch (e) {
        logFailure('quote', symbol, e);
        return null;
    }
}

// Shared, short-lived quotes for anything shown live on screen (pages and /api/quotes)
export async function getLiveQuotes(symbols: string[]) {
    // Symbols the free plan can't price are skipped instead of spending a request on a 403
    const quotes = await Promise.all(symbols.map((s) => (hasFinnhubQuotes(s) ? getQuote(s, LIVE_QUOTE_TTL) : null)));
    return Object.fromEntries(symbols.map((s, i) => [s, quotes[i]?.c ? quotes[i] : null]));
}

export async function getCompanyProfile(symbol: string) {
    // Profiles exist for stocks Finnhub free covers; crypto pairs and non-US listings have none
    if (symbol.includes(':') || !hasFinnhubQuotes(symbol)) return null;
    try {
        const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}`;
        // Cache profile for 24 hours
        return await fetchJSON<FinnhubCompanyProfile>(url, 86400);
    } catch (e) {
        logFailure('profile', symbol, e);
        return null;
    }
}

export async function getWatchlistData(symbols: string[]) {
    if (!symbols || symbols.length === 0) return [];

    // Fetch quotes and profiles in parallel
    const promises = symbols.map(async (sym) => {
        const upper = sym.toUpperCase();
        const isTw =
            upper.startsWith('TWSE:') ||
            upper.startsWith('TPEX:') ||
            upper.endsWith('.TW') ||
            upper.endsWith('.TWO') ||
            TAIWAN_CODE_REGEX.test(upper) ||
            parseTaiwanKey(upper) !== null;

        if (isTw) {
            const [twQuote, twSec] = await Promise.all([
                getTaiwanQuote(sym),
                getTaiwanSecurity(sym),
            ]);

            const price = twQuote?.price ?? null;
            const change = twQuote?.change ?? null;
            const changePercent = twQuote?.changePercent ?? null;
            const currency = twQuote?.currency ?? twSec?.currency ?? null;
            const name = twSec?.name || sym;
            const source = twQuote?.source ?? (twSec?.exchange === 'TPEX' ? 'tpex' : 'twse');
            const tradingDate = twQuote?.tradingDate ?? null;
            const mode = 'close' as const;

            return {
                symbol: sym,
                price,
                change,
                changePercent,
                currency,
                name,
                logo: undefined,
                marketCap: undefined,
                peRatio: 0,
                source,
                tradingDate,
                mode,
            };
        }

        const covered = hasFinnhubQuotes(sym);
        const [quote, profile] = covered
            ? await Promise.all([getQuote(sym, LIVE_QUOTE_TTL), getCompanyProfile(sym)])
            : [null, null];

        return {
            symbol: sym,
            price: quote?.c || 0,
            change: quote?.d || 0,
            changePercent: quote?.dp || 0,
            currency: profile?.currency || 'USD',
            name: profile?.name || sym,
            logo: profile?.logo,
            marketCap: profile?.marketCapitalization,
            peRatio: 0 // Finnhub 'quote' and 'profile2' don't easily give real-time PE. Might need 'metric' endpoint, but skipping for now to save rate limits.
        };
    });

    return await Promise.all(promises);
}


type FinnhubCandleResponse = {
    c?: number[]; // close prices
    t?: number[]; // unix timestamps (seconds)
    s?: string;   // status: 'ok' | 'no_data' | ...
    o?: number[]; // open prices
    h?: number[]; // high prices
    l?: number[]; // low prices
    v?: number[]; // volume
};

const candleResponseCache = createCandleCache();

/** Preserve source failures for the candle router; legacy callers still receive null. */
export async function getCandlesWithReason(symbol: string, resolution = 'D', days = 120): Promise<CandleResult> {
    const source: CandleSource = { provider: 'finnhub', symbol, timeZone: 'UTC' };
    if (getFinnhubKeys().length === 0) return failure('missing-config', source);
    return candleResponseCache.get(`finnhub:${symbol}:${resolution}:${days}`, source, () => withSlot(async () => {
        const to = Math.floor(Date.now() / 1000);
        const from = to - days * 86400;
        const url =
            `${FINNHUB_BASE_URL}/stock/candle?symbol=${encodeURIComponent(symbol)}` +
            `&resolution=${resolution}&from=${from}&to=${to}`;
        // Keep key rotation and the shared limiter, but do not collapse HTTP errors to null.
        const response = await fetchWithKeyPool(url, 0);
        if (response.status === 401 || response.status === 403) throw new CandleRequestError('missing-config');
        if (response.status === 404) throw new CandleRequestError('unsupported-symbol');
        if (!response.ok) throw new CandleRequestError('api-error');
        const data = await response.json() as FinnhubCandleResponse | null;
        if (data?.s === 'no_data') throw new CandleRequestError('no-data');
        if (data?.s !== 'ok' || !Array.isArray(data.c)) throw new CandleRequestError('api-error');
        return normalizeCandles(data.c.map((c, i) => ({
            c, t: data.t?.[i], o: data.o?.[i], h: data.h?.[i], l: data.l?.[i], v: data.v?.[i],
        })));
    }));
}

export async function getCandles(symbol: string, resolution = 'D', days = 120) {
    return (await getCandlesWithReason(symbol, resolution, days)).candles;
}

export async function getNews(symbols?: string[]): Promise<MarketNewsArticle[]> {
    try {
        const range = getDateRange(5);
        if (getFinnhubKeys().length === 0) {
            throw new Error('FINNHUB API key is not configured');
        }
        const cleanSymbols = (symbols || [])
            .map((s) => s?.trim().toUpperCase())
            .filter((s): s is string => Boolean(s));

        const maxArticles = 6;

        // If we have symbols, try to fetch company news per symbol and round-robin select
        if (cleanSymbols.length > 0) {
            const perSymbolArticles: Record<string, RawNewsArticle[]> = {};

            await Promise.all(
                cleanSymbols.map(async (sym) => {
                    try {
                        const url = `${FINNHUB_BASE_URL}/company-news?symbol=${encodeURIComponent(sym)}&from=${range.from}&to=${range.to}`;
                        const articles = await fetchJSON<RawNewsArticle[]>(url, 300);
                        perSymbolArticles[sym] = (articles || []).filter(validateArticle);
                    } catch (e) {
                        console.error('Error fetching company news for', sym, e);
                        perSymbolArticles[sym] = [];
                    }
                })
            );

            const collected: MarketNewsArticle[] = [];
            // Round-robin up to 6 picks
            for (let round = 0; round < maxArticles; round++) {
                for (let i = 0; i < cleanSymbols.length; i++) {
                    const sym = cleanSymbols[i];
                    const list = perSymbolArticles[sym] || [];
                    if (list.length === 0) continue;
                    const article = list.shift();
                    if (!article || !validateArticle(article)) continue;
                    collected.push(formatArticle(article, true, sym, round));
                    if (collected.length >= maxArticles) break;
                }
                if (collected.length >= maxArticles) break;
            }

            if (collected.length > 0) {
                // Sort by datetime desc
                collected.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
                return collected.slice(0, maxArticles);
            }
            // If none collected, fall through to general news
        }

        // General market news fallback or when no symbols provided
        const generalUrl = `${FINNHUB_BASE_URL}/news?category=general`;
        const general = await fetchJSON<RawNewsArticle[]>(generalUrl, 300);

        const seen = new Set<string>();
        const unique: RawNewsArticle[] = [];
        for (const art of general || []) {
            if (!validateArticle(art)) continue;
            const key = `${art.id}-${art.url}-${art.headline}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(art);
            if (unique.length >= 20) break; // cap early before final slicing
        }

        const formatted = unique.slice(0, maxArticles).map((a, idx) => formatArticle(a, false, undefined, idx));
        return formatted;
    } catch (err) {
        console.error('getNews error:', err);
        throw new Error('Failed to fetch news');
    }
}

export const searchStocks = cache(async (query?: string): Promise<StockWithWatchlistStatus[]> => {
    try {
        const trimmed = typeof query === 'string' ? query.trim() : '';

        if (!trimmed) {
            // Shown in the palette on every page, so no API calls: Finnhub's free tier is 60 req/min
            const popular = POPULAR_STOCKS.map(({ symbol, name, exchange }) => ({
                symbol,
                description: name,
                displaySymbol: symbol,
                type: 'Common Stock',
                __exchange: exchange,
            }));
            return popular.map((r) => ({
                symbol: (r.symbol || '').toUpperCase(),
                name: r.description || (r.symbol || '').toUpperCase(),
                exchange: getExchangeLabel((r.symbol || '').toUpperCase(), r.__exchange),
                type: r.type || 'Stock',
                isInWatchlist: false,
            })).slice(0, 15);
        }

        // A public server action: only signed-in users may spend quota on searches
        if (!(await getSession())?.user) return [];

        const isBareCode = TAIWAN_CODE_REGEX.test(trimmed);
        const hasChinese = /[\u4e00-\u9fa5]/.test(trimmed);
        const explicitTaiwan = parseTaiwanKey(trimmed) !== null;
        const isTaiwanLikely = isBareCode || hasChinese || explicitTaiwan;

        // Search Taiwan securities from official catalog/repo BEFORE checking FINNHUB_KEYS
        let taiwanResults: StockWithWatchlistStatus[] = [];
        let taiwanError: unknown = null;
        try {
            taiwanResults = await searchTaiwanSecurities(trimmed);
        } catch (err) {
            taiwanError = err;
        }

        // If specifically a Taiwan query and DB failed: do not trigger external API and do not declare "no products"
        if (isTaiwanLikely && taiwanError) {
            throw taiwanError;
        }

        // Bare numbers, Chinese, or explicit Taiwan queries should NOT be sent as US stock search
        if (isTaiwanLikely) {
            return taiwanResults.slice(0, 15);
        }

        // Non-Taiwan queries: proceed with Finnhub search if keys exist
        const finnhubKeys = getFinnhubKeys();
        if (finnhubKeys.length === 0) {
            return taiwanResults.slice(0, 15);
        }

        const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(trimmed)}`;
        const data = await fetchJSON<FinnhubSearchResponse>(url, 1800);
        const results: SearchStockCandidate[] = Array.isArray(data?.result) ? data.result : [];

        const finnhubMapped: StockWithWatchlistStatus[] = results.map((r) => {
            const upper = (r.symbol || '').toUpperCase();
            const name = r.description || upper;
            const exchangeFromProfile = r.__exchange;
            const exchange = getExchangeLabel(upper, exchangeFromProfile);
            const type = r.type || 'Stock';
            return {
                symbol: upper,
                name,
                exchange,
                type,
                isInWatchlist: false,
            };
        });

        // Merge Taiwan results with Finnhub results, deduplicate by symbol, max 15 items
        const seen = new Set<string>();
        const combined: StockWithWatchlistStatus[] = [];
        for (const item of [...taiwanResults, ...finnhubMapped]) {
            const sym = item.symbol.toUpperCase();
            if (!seen.has(sym)) {
                seen.add(sym);
                combined.push(item);
            }
        }

        return combined.slice(0, 15);
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('台股資料庫準備中或同步未啟用')) {
            throw err;
        }
        console.error('Error in stock search:', err);
        return [];
    }
});

/** Expected readiness failures must cross the server-action boundary as data.
 * Production Next.js redacts messages on thrown errors before the client sees them.
 */
export async function searchStocksWithStatus(query?: string): Promise<{
    stocks: StockWithWatchlistStatus[];
    error: string | null;
}> {
    try {
        return { stocks: await searchStocks(query), error: null };
    } catch {
        return {
            stocks: [],
            error: '官方台股資料尚未初始化或暫時無法讀取，請稍後再試。',
        };
    }
}
