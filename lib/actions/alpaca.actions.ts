'use server';

import { getCandles } from './finnhub.actions';

const ALPACA_DATA_BASE = 'https://data.alpaca.markets';
const FETCH_TIMEOUT_MS = 8000;
// Daily candles barely move intraday: cache for an hour (same spirit as the
// Finnhub/ CoinGecko caches).
const BARS_TTL_MS = 3600_000;
// 失敗冷卻：負向結果（API 錯誤／無資料）也寫入快取但只用短 TTL，
// 沿用 finnhub.actions.ts 的 FAILURE_TTL_MS 機制與值。
const FAILURE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;
const DEFAULT_DAYS = 120; // matches getCandles' default window
// 統一入口的預設天數（需求規格書指定）：指標引擎需要夠長的歷史。
const DAILY_CANDLES_DEFAULT_DAYS = 400;
// 幣種 symbol 很少變動，快取 24 小時（全域約束）。
const CRYPTO_PAIR_TTL_MS = 24 * 3600_000;
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
// 沿用 coingecko.actions.ts 的免費 demo key 邏輯：有設就帶上，省限流。
const COINGECKO_DEMO_API_KEY = process.env.COINGECKO_DEMO_API_KEY?.trim();

/** Same shape as `getCandles` in finnhub.actions.ts (Task 2/3 depend on it). */
export type RawCandles = {
    c: number[];
    t: number[];
    o: number[];
    h: number[];
    l: number[];
    v: number[];
    s: 'ok';
};

type AlpacaBar = {
    t?: string; // ISO 8601 timestamp
    o?: number;
    h?: number;
    l?: number;
    c?: number;
    v?: number;
};

type AlpacaStockBarsResponse = { bars?: AlpacaBar[] };
type AlpacaCryptoBarsResponse = { bars?: Record<string, AlpacaBar[]> };

// Tiny per-instance TTL cache. The key is deterministic per
// (endpoint, symbol/pair, days) — deliberately NOT the full request URL,
// because the URL embeds start/end timestamps with millisecond precision that
// change on every call and would make the cache never hit.
const barsCache = new Map<string, { value: RawCandles | null; freshUntil: number }>();

/** Test-only: clears the bars cache so tests are isolated from each other. */
export async function __resetAlpacaBarsCacheForTests(): Promise<void> {
    barsCache.clear();
}

function barsCacheKey(path: string, query: string, days: number): string {
    return `bars:${path}:${query}:days=${days}`;
}

function alpacaCredentials(): { key: string; secret: string } | null {
    const key = process.env.ALPACA_API_KEY?.trim();
    const secret = process.env.ALPACA_API_SECRET?.trim();
    if (!key || !secret) return null;
    return { key, secret };
}

function barsUrl(path: string, query: string, days: number): string {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400_000);
    return (
        `${ALPACA_DATA_BASE}${path}?${query}&timeframe=1Day` +
        `&start=${start.toISOString()}&end=${end.toISOString()}&limit=1000&sort=asc`
    );
}

async function cachedAlpacaBars(
    cacheKey: string,
    url: string,
    extract: (data: unknown) => AlpacaBar[] | null,
): Promise<RawCandles | null> {
    // No credentials: return null (never throw) so the caller can fall back.
    const creds = alpacaCredentials();
    if (!creds) return null;

    // 負向快取：命中且未過期時直接回（值為 null 即不重打 API）。
    const hit = barsCache.get(cacheKey);
    if (hit && hit.freshUntil > Date.now()) return hit.value;

    const store = (value: RawCandles | null, ttlMs: number) => {
        if (barsCache.size >= MAX_CACHE_ENTRIES) barsCache.delete(barsCache.keys().next().value!);
        barsCache.set(cacheKey, { value, freshUntil: Date.now() + ttlMs });
    };

    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: {
                'APCA-API-KEY-ID': creds.key,
                'APCA-API-SECRET-KEY': creds.secret,
            },
        });
        if (!res.ok) throw new Error(`Alpaca responded ${res.status}`);
        const bars = extract(await res.json());
        if (!bars || bars.length === 0) {
            // 下架／無資料的股票：負向結果寫短 TTL 快取，避免每次瀏覽重打 Alpaca。
            store(null, FAILURE_TTL_MS);
            return null;
        }
        const candles: RawCandles = {
            c: bars.map((b) => b.c ?? 0),
            t: bars.map((b) => Date.parse(b.t ?? '') / 1000),
            o: bars.map((b) => b.o ?? 0),
            h: bars.map((b) => b.h ?? 0),
            l: bars.map((b) => b.l ?? 0),
            v: bars.map((b) => b.v ?? 0),
            s: 'ok',
        };
        store(candles, BARS_TTL_MS);
        return candles;
    } catch (e) {
        // Never throws: any API error returns null so the fallback can take over.
        console.error('Alpaca fetch failed:', url.split('?')[0], e);
        // 失敗冷卻：負向結果寫短 TTL 快取，避免每次瀏覽重打 Alpaca。
        store(null, FAILURE_TTL_MS);
        return null;
    }
}

/** Daily stock bars from Alpaca (IEX feed). Never throws; null on any failure. */
export async function getAlpacaStockBars(symbol: string, days = DEFAULT_DAYS): Promise<RawCandles | null> {
    const sym = (symbol || '').trim().toUpperCase();
    if (!sym) return null;
    const path = `/v2/stocks/${encodeURIComponent(sym)}/bars`;
    const url = barsUrl(path, 'feed=iex', days);
    return cachedAlpacaBars(barsCacheKey(path, 'feed=iex', days), url, (data) => {
        const bars = (data as AlpacaStockBarsResponse | null)?.bars;
        return Array.isArray(bars) ? bars : null;
    });
}

/**
 * Daily crypto bars from Alpaca, e.g. pair `BTC/USD`.
 * Never throws; null on any failure.
 */
export async function getAlpacaCryptoBars(pair: string, days = DEFAULT_DAYS): Promise<RawCandles | null> {
    const p = (pair || '').trim().toUpperCase();
    if (!p) return null;
    const path = '/v1beta3/crypto/us/bars';
    const query = `symbols=${encodeURIComponent(p)}`;
    const url = barsUrl(path, query, days);
    return cachedAlpacaBars(barsCacheKey(path, query, days), url, (data) => {
        const bars = (data as AlpacaCryptoBarsResponse | null)?.bars?.[p];
        return Array.isArray(bars) ? bars : null;
    });
}

// ---- 統一 K 線入口（Task 2）----

// `CG:{coingecko_id}` → Alpaca 交易對的對應快取（24 小時；負向結果短 TTL）。
const cryptoPairCache = new Map<string, { value: string | null; freshUntil: number }>();

/** Test-only: clears the crypto-pair cache so tests are isolated from each other. */
export async function __resetCryptoPairCacheForTests(): Promise<void> {
    cryptoPairCache.clear();
}

/**
 * `CG:{coingecko_id}` → Alpaca 幣交易對 `{SYMBOL}/USD`，例如 `CG:bitcoin` → `BTC/USD`。
 * 查 CoinGecko /coins/{id} 的 symbol 欄位（轉大寫），結果快取 24 小時。
 * 永不拋錯；查無此幣或 API 失敗時回 null。
 */
async function resolveCryptoPair(cgId: string): Promise<string | null> {
    const id = (cgId || '').trim().toLowerCase();
    if (!id) return null;
    // 負向快取：命中且未過期時直接回（值為 null 即不重打 CoinGecko）。
    const hit = cryptoPairCache.get(id);
    if (hit && hit.freshUntil > Date.now()) return hit.value;
    const store = (value: string | null, ttlMs: number) => {
        if (cryptoPairCache.size >= MAX_CACHE_ENTRIES) cryptoPairCache.delete(cryptoPairCache.keys().next().value!);
        cryptoPairCache.set(id, { value, freshUntil: Date.now() + ttlMs });
    };
    try {
        const res = await fetch(`${COINGECKO_BASE}/coins/${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: COINGECKO_DEMO_API_KEY ? { 'x-cg-demo-api-key': COINGECKO_DEMO_API_KEY } : {},
        });
        if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
        const data = (await res.json()) as { symbol?: string };
        const sym = (data?.symbol || '').trim().toUpperCase();
        if (!sym) {
            // 查無 symbol：負向結果寫短 TTL 快取，避免每次瀏覽都重打 CoinGecko。
            store(null, FAILURE_TTL_MS);
            return null;
        }
        const pair = `${sym}/USD`;
        store(pair, CRYPTO_PAIR_TTL_MS);
        return pair;
    } catch (e) {
        // 永不拋錯：查無幣種就讓上層回「無指標資料」。
        console.error('CoinGecko coin lookup failed:', id, e);
        // 失敗冷卻：負向結果寫短 TTL 快取，避免每個未知 CG:* 每次瀏覽都重打 CoinGecko。
        store(null, FAILURE_TTL_MS);
        return null;
    }
}

/**
 * 統一日 K 線入口：指標引擎唯一的 K 線資料源。
 * - 美股（非 CG: 前綴）：Alpaca 優先 → 失敗時 Finnhub 備援（付費用戶）。
 * - 加密貨幣（`CG:{coingecko_id}`）：CoinGecko 查 symbol → Alpaca 幣 K 線；
 *   無資料時回 null（CoinGecko 沒有日 K，加密貨幣無 Finnhub 備援）。
 * 永不拋錯；失敗回 null。
 */
export async function getDailyCandles(
    symbol: string,
    days = DAILY_CANDLES_DEFAULT_DAYS,
): Promise<RawCandles | null> {
    const sym = (symbol || '').trim();
    if (!sym) return null;
    if (sym.toUpperCase().startsWith('CG:')) {
        const pair = await resolveCryptoPair(sym.slice(3));
        if (!pair) return null;
        return getAlpacaCryptoBars(pair, days);
    }
    const bars = await getAlpacaStockBars(sym, days);
    if (bars) return bars;
    // Finnhub 備援（/stock/candle 是付費端點，免費版 key 回 403 時這裡同樣回 null）。
    const fb = await getCandles(sym, 'D', days);
    if (!fb) return null;
    // 轉成 RawCandles 形狀（getCandles 保證非 null 時 s === 'ok'）。
    return { c: fb.c, t: fb.t, o: fb.o, h: fb.h, l: fb.l, v: fb.v, s: 'ok' };
}
