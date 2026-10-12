import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    getAlpacaStockBars,
    getAlpacaCryptoBars,
    getDailyCandles,
    __resetAlpacaBarsCacheForTests,
    __resetCryptoPairCacheForTests,
} from './alpaca.actions';

// finnhub.actions.ts 在測試環境無法載入（better-auth 於載入時連 MongoDB，
// 且 FINNHUB_KEYS 於載入時讀 env）。用保留真實契約的 test double 取代
// getCandles：打 https://finnhub.io/api/v1/stock/candle、失敗回 null 不拋錯。
// getDailyCandles 的 Finnhub 備援走的是 stubbed global fetch，已由
// mockRoutedFetch 接管。
vi.mock('./finnhub.actions', () => ({
    getCandles: vi.fn(async (symbol: string, resolution = 'D', days = 120) => {
        const to = Math.floor(Date.now() / 1000);
        const from = to - days * 86400;
        const url =
            `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}` +
            `&resolution=${resolution}&from=${from}&to=${to}`;
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = (await res.json()) as {
                s?: string;
                c?: number[];
                t?: number[];
                o?: number[];
                h?: number[];
                l?: number[];
                v?: number[];
            };
            if (!data || data.s !== 'ok' || !Array.isArray(data.c) || data.c.length === 0) return null;
            return {
                c: data.c,
                t: Array.isArray(data.t) ? data.t : [],
                s: 'ok' as const,
                o: Array.isArray(data.o) ? data.o : [],
                h: Array.isArray(data.h) ? data.h : [],
                l: Array.isArray(data.l) ? data.l : [],
                v: Array.isArray(data.v) ? data.v : [],
            };
        } catch {
            return null;
        }
    }),
}));

/**
 * Task 1 測試：Alpaca 日 K 客戶端。
 * mock fetch 回傳 Alpaca 格式（含 ISO 時間），驗證轉換出正確的 unix
 * timestamp 與 OHLCV 陣列；無憑證 / API 錯誤時回 null（不拋錯）。
 */

const ISO_1 = '2026-10-09T04:00:00Z';
const ISO_2 = '2026-10-12T04:00:00Z';
const T1 = Date.parse(ISO_1) / 1000;
const T2 = Date.parse(ISO_2) / 1000;

const STOCK_BARS = [
    { t: ISO_1, o: 100, h: 105, l: 99, c: 104, v: 1000, n: 50, vw: 102 },
    { t: ISO_2, o: 104, h: 108, l: 103, c: 107, v: 2000, n: 60, vw: 105 },
];

const CRYPTO_BARS = [
    { t: ISO_1, o: 67000, h: 68000, l: 66000, c: 67500, v: 12.5, n: 100, vw: 67000 },
    { t: ISO_2, o: 67500, h: 69000, l: 67000, c: 68500, v: 15, n: 120, vw: 68000 },
];

function mockFetch(data: unknown, ok = true, status = 200) {
    return vi.fn().mockResolvedValue({
        ok,
        status,
        json: () => Promise.resolve(data),
    } as unknown as Response);
}

const ORIG_KEY = process.env.ALPACA_API_KEY;
const ORIG_SECRET = process.env.ALPACA_API_SECRET;

beforeEach(async () => {
    process.env.ALPACA_API_KEY = 'test-key';
    process.env.ALPACA_API_SECRET = 'test-secret';
    await __resetAlpacaBarsCacheForTests();
});

afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIG_KEY === undefined) delete process.env.ALPACA_API_KEY;
    else process.env.ALPACA_API_KEY = ORIG_KEY;
    if (ORIG_SECRET === undefined) delete process.env.ALPACA_API_SECRET;
    else process.env.ALPACA_API_SECRET = ORIG_SECRET;
});

describe('getAlpacaStockBars', () => {
    it('converts Alpaca stock bars (ISO t) to RawCandles with unix timestamps', async () => {
        const fetchMock = mockFetch({ bars: STOCK_BARS, symbol: 'AAPL' });
        vi.stubGlobal('fetch', fetchMock);

        const res = await getAlpacaStockBars('AAPL', 30);

        expect(res).not.toBeNull();
        expect(res!.s).toBe('ok');
        expect(res!.t).toEqual([T1, T2]);
        expect(res!.o).toEqual([100, 104]);
        expect(res!.h).toEqual([105, 108]);
        expect(res!.l).toEqual([99, 103]);
        expect(res!.c).toEqual([104, 107]);
        expect(res!.v).toEqual([1000, 2000]);
    });

    it('sends APCA auth headers to the /v2/stocks/{SYM}/bars endpoint with feed=iex', async () => {
        const fetchMock = mockFetch({ bars: STOCK_BARS, symbol: 'AAPL' });
        vi.stubGlobal('fetch', fetchMock);

        await getAlpacaStockBars('aapl', 30);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('https://data.alpaca.markets/v2/stocks/AAPL/bars');
        expect(url).toContain('timeframe=1Day');
        expect(url).toContain('feed=iex');
        expect(url).toContain('sort=asc');
        expect(url).toContain('limit=1000');
        const headers = init.headers as Record<string, string>;
        expect(headers['APCA-API-KEY-ID']).toBe('test-key');
        expect(headers['APCA-API-SECRET-KEY']).toBe('test-secret');
    });

    it('returns null when credentials are missing (fetch never called)', async () => {
        delete process.env.ALPACA_API_KEY;
        delete process.env.ALPACA_API_SECRET;
        const fetchMock = mockFetch({ bars: STOCK_BARS });
        vi.stubGlobal('fetch', fetchMock);

        const res = await getAlpacaStockBars('MSFT', 30);

        expect(res).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns null on API error without throwing', async () => {
        const fetchMock = mockFetch({ message: 'unauthorized' }, false, 401);
        vi.stubGlobal('fetch', fetchMock);

        const res = await getAlpacaStockBars('GOOGL', 30);

        expect(res).toBeNull();
    });

    it('returns null on empty bars', async () => {
        const fetchMock = mockFetch({ bars: [] });
        vi.stubGlobal('fetch', fetchMock);

        const res = await getAlpacaStockBars('TSLA', 30);

        expect(res).toBeNull();
    });

    it('serves identical requests from cache within the hour (no second fetch)', async () => {
        const fetchMock = mockFetch({ bars: STOCK_BARS, symbol: 'AAPL' });
        vi.stubGlobal('fetch', fetchMock);

        const first = await getAlpacaStockBars('AAPL', 30);
        const second = await getAlpacaStockBars('AAPL', 30);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
        expect(second).not.toBeNull();
    });

    it('負向快取：API 錯誤時寫短 TTL，快取命中內重複呼叫不重打', async () => {
        const fetchMock = mockFetch({ message: 'forbidden' }, false, 403);
        vi.stubGlobal('fetch', fetchMock);

        expect(await getAlpacaStockBars('ZZZZ', 30)).toBeNull();
        expect(await getAlpacaStockBars('ZZZZ', 30)).toBeNull();

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('負向快取：空 bars 時寫短 TTL，快取命中內重複呼叫不重打', async () => {
        const fetchMock = mockFetch({ bars: [] });
        vi.stubGlobal('fetch', fetchMock);

        expect(await getAlpacaStockBars('DELISTED', 30)).toBeNull();
        expect(await getAlpacaStockBars('DELISTED', 30)).toBeNull();

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('負向快取只冷卻不鎖死：過期後會重打 API', async () => {
        vi.useFakeTimers();
        try {
            const fetchMock = mockFetch({ message: 'forbidden' }, false, 403);
            vi.stubGlobal('fetch', fetchMock);

            await getAlpacaStockBars('ZZZZ', 30);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            // FAILURE_TTL_MS = 60s；冷卻過後再次呼叫應重打 API。
            await vi.advanceTimersByTimeAsync(61_000);
            expect(await getAlpacaStockBars('ZZZZ', 30)).toBeNull();
            expect(fetchMock).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('getAlpacaCryptoBars', () => {
    it('extracts the pair bars from the nested map and converts to RawCandles', async () => {
        const fetchMock = mockFetch({ bars: { 'BTC/USD': CRYPTO_BARS } });
        vi.stubGlobal('fetch', fetchMock);

        const res = await getAlpacaCryptoBars('BTC/USD', 30);

        expect(res).not.toBeNull();
        expect(res!.s).toBe('ok');
        expect(res!.t).toEqual([T1, T2]);
        expect(res!.c).toEqual([67500, 68500]);
        expect(res!.o).toEqual([67000, 67500]);
        expect(res!.v).toEqual([12.5, 15]);
    });

    it('hits the /v1beta3/crypto/us/bars endpoint with the pair in symbols', async () => {
        const fetchMock = mockFetch({ bars: { 'ETH/USD': CRYPTO_BARS } });
        vi.stubGlobal('fetch', fetchMock);

        await getAlpacaCryptoBars('ETH/USD', 30);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('https://data.alpaca.markets/v1beta3/crypto/us/bars');
        expect(url).toContain('timeframe=1Day');
        expect(url).toContain('sort=asc');
    });

    it('returns null when credentials are missing', async () => {
        delete process.env.ALPACA_API_KEY;
        delete process.env.ALPACA_API_SECRET;
        const fetchMock = mockFetch({ bars: { 'BTC/USD': CRYPTO_BARS } });
        vi.stubGlobal('fetch', fetchMock);

        expect(await getAlpacaCryptoBars('BTC/USD', 30)).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns null on API error and on missing pair without throwing', async () => {
        vi.stubGlobal('fetch', mockFetch({ message: 'forbidden' }, false, 403));
        expect(await getAlpacaCryptoBars('DOGE/USD', 30)).toBeNull();

        vi.stubGlobal('fetch', mockFetch({ bars: {} }));
        expect(await getAlpacaCryptoBars('XRP/USD', 30)).toBeNull();
    });
});

/**
 * Task 2 測試：統一 K 線入口 getDailyCandles（含 Fallback＋幣種對應）。
 * 用依 URL 路由的 mock fetch，同時服務 Alpaca / Finnhub / CoinGecko 三家。
 */

const FINNHUB_CANDLES = {
    s: 'ok',
    c: [300, 305],
    t: [T1, T2],
    o: [298, 302],
    h: [302, 307],
    l: [297, 301],
    v: [5000, 6000],
};

type Route = { match: string; data: unknown; ok?: boolean; status?: number };

function mockRoutedFetch(routes: Route[]) {
    return vi.fn().mockImplementation((url: string) => {
        const r = routes.find((rt) => url.includes(rt.match));
        const ok = r ? (r.ok ?? true) : false;
        const status = r?.status ?? (r ? 200 : 404);
        return Promise.resolve({
            ok,
            status,
            json: () => Promise.resolve(r?.data ?? { message: 'not found' }),
        } as unknown as Response);
    });
}

describe('getDailyCandles', () => {
    beforeEach(async () => {
        await __resetCryptoPairCacheForTests();
    });

    it('股票：Alpaca 成功時回 Alpaca 資料，Finnhub 不被呼叫', async () => {
        const fetchMock = mockRoutedFetch([
            { match: 'data.alpaca.markets/v2/stocks/AAPL/bars', data: { bars: STOCK_BARS, symbol: 'AAPL' } },
            { match: 'finnhub.io', data: FINNHUB_CANDLES },
        ]);
        vi.stubGlobal('fetch', fetchMock);

        const res = await getDailyCandles('AAPL', 30);

        expect(res).not.toBeNull();
        expect(res!.c).toEqual([104, 107]); // Alpaca 資料，非 Finnhub 的 [300, 305]
        expect(fetchMock.mock.calls.every(([u]) => !(u as string).includes('finnhub.io'))).toBe(true);
    });

    it('股票：Alpaca 失敗時 fallback 到 Finnhub /stock/candle', async () => {
        const fetchMock = mockRoutedFetch([
            {
                match: 'data.alpaca.markets/v2/stocks/MSFT/bars',
                data: { message: 'unauthorized' },
                ok: false,
                status: 401,
            },
            { match: 'finnhub.io', data: FINNHUB_CANDLES },
        ]);
        vi.stubGlobal('fetch', fetchMock);

        const res = await getDailyCandles('MSFT', 30);

        expect(res).not.toBeNull();
        expect(res!.c).toEqual([300, 305]);
        expect(res!.s).toBe('ok');
        const finnhubCalls = fetchMock.mock.calls.filter(([u]) => (u as string).includes('finnhub.io'));
        expect(finnhubCalls.length).toBeGreaterThan(0);
        expect(finnhubCalls[0][0] as string).toContain('/stock/candle');
        expect(finnhubCalls[0][0] as string).toContain('resolution=D');
    });

    it('股票：Alpaca 與 Finnhub 都失敗時回 null，不拋錯', async () => {
        const fetchMock = mockRoutedFetch([
            { match: 'data.alpaca.markets', data: { message: 'forbidden' }, ok: false, status: 403 },
            { match: 'finnhub.io', data: { error: 'no data' }, ok: false, status: 403 },
        ]);
        vi.stubGlobal('fetch', fetchMock);

        expect(await getDailyCandles('TSLA', 30)).toBeNull();
    });

    it('加密貨幣：CG:bitcoin 對應到 Alpaca BTC/USD', async () => {
        const fetchMock = mockRoutedFetch([
            {
                match: 'api.coingecko.com/api/v3/coins/bitcoin',
                data: { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
            },
            {
                match: 'data.alpaca.markets/v1beta3/crypto/us/bars',
                data: { bars: { 'BTC/USD': CRYPTO_BARS } },
            },
        ]);
        vi.stubGlobal('fetch', fetchMock);

        const res = await getDailyCandles('CG:bitcoin', 30);

        expect(res).not.toBeNull();
        expect(res!.c).toEqual([67500, 68500]);
        const cryptoCalls = fetchMock.mock.calls.filter(([u]) =>
            (u as string).includes('data.alpaca.markets/v1beta3/crypto'),
        );
        expect(cryptoCalls.length).toBe(1);
        expect(cryptoCalls[0][0] as string).toContain('symbols=BTC%2FUSD');
    });

    it('加密貨幣：CoinGecko 查無此幣 → null，Alpaca 不被呼叫', async () => {
        const fetchMock = mockRoutedFetch([
            {
                match: 'api.coingecko.com/api/v3/coins/unknowncoin',
                data: { error: 'not found' },
                ok: false,
                status: 404,
            },
            { match: 'data.alpaca.markets', data: { bars: {} } },
        ]);
        vi.stubGlobal('fetch', fetchMock);

        expect(await getDailyCandles('CG:unknowncoin', 30)).toBeNull();
        expect(fetchMock.mock.calls.every(([u]) => !(u as string).includes('data.alpaca.markets'))).toBe(true);
    });

    it('幣種 symbol 對應快取 24 小時：重複呼叫不打第二次 CoinGecko', async () => {
        const fetchMock = mockRoutedFetch([
            {
                match: 'api.coingecko.com/api/v3/coins/ethereum',
                data: { id: 'ethereum', symbol: 'eth', name: 'Ethereum' },
            },
            {
                match: 'data.alpaca.markets/v1beta3/crypto/us/bars',
                data: { bars: { 'ETH/USD': CRYPTO_BARS } },
            },
        ]);
        vi.stubGlobal('fetch', fetchMock);

        const first = await getDailyCandles('CG:ethereum', 30);
        const second = await getDailyCandles('CG:ethereum', 30);

        expect(first).not.toBeNull();
        expect(second).toEqual(first);
        const cgCalls = fetchMock.mock.calls.filter(([u]) => (u as string).includes('api.coingecko.com'));
        expect(cgCalls.length).toBe(1);
    });

    it('加密貨幣：未知幣種的負向結果快取短 TTL，重複呼叫不打第二次 CoinGecko', async () => {
        const fetchMock = mockRoutedFetch([
            {
                match: 'api.coingecko.com/api/v3/coins/unknowncoin',
                data: { error: 'coin not found' },
                ok: false,
                status: 404,
            },
            { match: 'data.alpaca.markets', data: { bars: {} } },
        ]);
        vi.stubGlobal('fetch', fetchMock);

        expect(await getDailyCandles('CG:unknowncoin', 30)).toBeNull();
        expect(await getDailyCandles('CG:unknowncoin', 30)).toBeNull();

        const cgCalls = fetchMock.mock.calls.filter(([u]) => (u as string).includes('api.coingecko.com'));
        expect(cgCalls.length).toBe(1);
        expect(fetchMock.mock.calls.every(([u]) => !(u as string).includes('data.alpaca.markets'))).toBe(true);
    });

    it('空字串 / 空 CG: id 回 null，不打任何 API', async () => {
        const fetchMock = mockRoutedFetch([]);
        vi.stubGlobal('fetch', fetchMock);

        expect(await getDailyCandles('', 30)).toBeNull();
        expect(await getDailyCandles('CG:', 30)).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
