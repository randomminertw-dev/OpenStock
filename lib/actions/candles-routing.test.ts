import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Finnhub imports authentication/database at module load. Keep this boundary offline.
const fallback = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('./finnhub.actions', () => ({
    getCandlesWithReason: async (symbol: string, resolution: string, days: number) => {
        const candles = await fallback(symbol, resolution, days);
        return { candles, reason: candles ? null : 'api-error', source: { provider: 'finnhub', symbol, timeZone: 'UTC' } };
    },
}));

const FINMIND_ROW = {
    date: '2026-10-09', stock_id: '2330', open: 100, max: 108, min: 99,
    close: 105, Trading_Volume: 1234000, Trading_money: 129570000,
    spread: 5, Trading_turnover: 4321,
};
const BAR = [1791504000000, '100', '108', '99', '105', '123.4', 1791590399999, '12957', 50, '60', '6300', '0'];
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });

beforeEach(() => {
    vi.resetModules();
    fallback.mockReset().mockResolvedValue(null);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T02:00:00Z'));
    vi.stubEnv('ALPACA_API_KEY', 'test-key');
    vi.stubEnv('ALPACA_API_SECRET', 'test-secret');
    vi.stubEnv('FINMIND_API_TOKEN', '');
});

describe('recent closed crypto factor candles', () => {
    const intervals = [['4h', 4, '4Hour'], ['8h', 8, '8Hour'], ['12h', 12, '12Hour']] as const;
    const now = Date.parse('2026-10-13T00:00:00Z');
    const binanceBar = (start: number, duration: number, volume: unknown = '12') =>
        [start, '100', '108', '99', '105', volume, start + duration - 1];
    const alpacaBar = (start: number, volume: unknown = 12) =>
        ({ t: new Date(start).toISOString(), o: 100, h: 108, l: 99, c: 105, v: volume });

    it.each(intervals)('loads recent closed Binance %s bars at the UTC boundary', async (interval, hours) => {
        vi.setSystemTime(now);
        const duration = hours * 3600_000;
        const fetcher = vi.fn().mockResolvedValue(response([
            binanceBar(now - duration, duration), binanceBar(now, duration),
            binanceBar(now - 2 * duration, duration),
        ]));
        vi.stubGlobal('fetch', fetcher);
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        const result = await getFactorCandlesWithReason('BINANCE:BTCUSDT', interval);
        expect(result).toMatchObject({ reason: null, source: { provider: 'binance', timeZone: 'UTC' },
            candles: { t: [(now - 2 * duration) / 1000, (now - duration) / 1000], c: [105, 105] } });
        const url = new URL(fetcher.mock.calls[0][0]);
        expect(url.searchParams.get('interval')).toBe(interval);
        expect(url.searchParams.get('symbol')).toBe('BTCUSDT');
        expect(Number(url.searchParams.get('startTime'))).toBe(now - 550 * duration);
        expect(Number(url.searchParams.get('endTime'))).toBe(now);
        expect(Number(url.searchParams.get('limit'))).toBeGreaterThanOrEqual(550);
        expect(fallback).not.toHaveBeenCalled();
    });

    it.each(['BINANCE:BTCUSDT', 'CG:bitcoin'])('retains at least 432 recent valid closed %s bars from a mixed 550-bar response', async (symbol) => {
        vi.setSystemTime(now);
        const duration = 4 * 3600_000;
        const bars = Array.from({ length: 550 }, (_, i) => {
            const start = now - (550 - i) * duration;
            return symbol.startsWith('BINANCE:') ? binanceBar(start, duration) : alpacaBar(start);
        });
        // Ten malformed/duplicate rows, one still-open bar and one latest valid close.
        if (symbol.startsWith('BINANCE:')) {
            bars[20] = [NaN, '100', '108', '99', '105', '12', NaN] as typeof bars[number];
            bars[21] = [now - 549 * duration, '100', '108', '99', '105', '12', now - 548 * duration - 1] as typeof bars[number];
            bars[22] = [now - 528 * duration, 'bad', '108', '99', '105', '12', now - 527 * duration - 1] as typeof bars[number];
        } else {
            bars[20] = { ...bars[20], t: 'not-a-date' };
            bars[21] = { ...bars[21], t: new Date(now - 549 * duration).toISOString() };
            bars[22] = { ...bars[22], o: NaN };
        }
        for (let i = 23; i < 30; i++) bars[i] = bars[22];
        bars[548] = symbol.startsWith('BINANCE:')
            ? binanceBar(now - duration, duration) as typeof bars[number]
            : alpacaBar(now - duration) as typeof bars[number];
        bars[549] = symbol.startsWith('BINANCE:')
            ? binanceBar(now, duration) as typeof bars[number]
            : alpacaBar(now) as typeof bars[number];
        const fetcher = vi.fn(async (url: string) => url.includes('api.coingecko.com')
            ? response({ symbol: 'btc' }) : url.includes('binance')
                ? response(bars) : response({ bars: { 'BTC/USD': bars } }));
        vi.stubGlobal('fetch', fetcher);
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        const result = await getFactorCandlesWithReason(symbol, '4h');
        expect(result.reason).toBeNull();
        expect(result.candles!.t.length).toBeGreaterThanOrEqual(432);
        expect(result.candles!.t.at(-1)).toBe((now - duration) / 1000);
        expect(result.candles!.t).not.toContain(now / 1000);
    });

    it.each(intervals)('loads recent closed CG %s bars through Alpaca', async (interval, hours, timeframe) => {
        vi.setSystemTime(now);
        const duration = hours * 3600_000;
        const fetcher = vi.fn(async (url: string) => url.includes('api.coingecko.com')
            ? response({ symbol: 'btc' })
            : response({ bars: { 'BTC/USD': [alpacaBar(now - 2 * duration), alpacaBar(now - duration), alpacaBar(now)] } }));
        vi.stubGlobal('fetch', fetcher);
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        const result = await getFactorCandlesWithReason('CG:bitcoin', interval);
        expect(result).toMatchObject({ reason: null, source: { provider: 'alpaca', symbol: 'BTC/USD', timeZone: 'UTC' },
            candles: { t: [(now - 2 * duration) / 1000, (now - duration) / 1000] } });
        const url = new URL(fetcher.mock.calls[1][0]);
        expect(url.pathname).toBe('/v1beta3/crypto/us/bars');
        expect(url.searchParams.get('timeframe')).toBe(timeframe);
        expect(Date.parse(url.searchParams.get('start')!)).toBe(now - 550 * duration);
        expect(Date.parse(url.searchParams.get('end')!)).toBe(now);
        expect(Number(url.searchParams.get('limit'))).toBeGreaterThanOrEqual(550);
        expect(fallback).not.toHaveBeenCalled();
    });

    it.each(['BINANCE:BTCUSDT', 'CG:bitcoin'])('excludes %s bars just before their UTC close', async (symbol) => {
        vi.setSystemTime(now - 1);
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('api.coingecko.com')
            ? response({ symbol: 'btc' }) : url.includes('binance')
                ? response([binanceBar(now - 8 * 3600_000, 4 * 3600_000), binanceBar(now - 4 * 3600_000, 4 * 3600_000)])
                : response({ bars: { 'BTC/USD': [alpacaBar(now - 8 * 3600_000), alpacaBar(now - 4 * 3600_000)] } })));
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        expect(await getFactorCandlesWithReason(symbol, '4h')).toMatchObject({
            candles: { t: [(now - 8 * 3600_000) / 1000] }, reason: null,
        });
    });

    it.each(['BINANCE:BTCUSDT', 'CG:bitcoin'])('preserves %s no-data when there are no complete bars', async (symbol) => {
        vi.setSystemTime(now);
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('api.coingecko.com')
            ? response({ symbol: 'btc' }) : url.includes('binance')
                ? response([binanceBar(now, 4 * 3600_000)])
                : response({ bars: { 'BTC/USD': [alpacaBar(now)] } })));
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        expect(await getFactorCandlesWithReason(symbol, '4h')).toMatchObject({ candles: null, reason: 'no-data' });
        expect(fallback).not.toHaveBeenCalled();
    });

    it.each([
        [{ unexpected: true }],
        [[now - 4 * 3600_000, '100']],
        [[now - 4 * 3600_000, '100', '108', '99', '105', '12', 'not-a-time']],
    ])('classifies nonempty malformed Binance interval responses as api-error: %j', async (row) => {
        vi.setSystemTime(now);
        const fetcher = vi.fn().mockResolvedValue(response([row]));
        vi.stubGlobal('fetch', fetcher);
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        expect(await getFactorCandlesWithReason('BINANCE:BTCUSDT', '4h')).toMatchObject({
            candles: null, reason: 'api-error', source: { provider: 'binance', symbol: 'BTCUSDT' },
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('interval')).toBe('4h');
        expect(fallback).not.toHaveBeenCalled();
    });

    it('keeps an empty Binance interval response as no-data', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        expect(await getFactorCandlesWithReason('BINANCE:BTCUSDT', '4h')).toMatchObject({
            candles: null, reason: 'no-data', source: { provider: 'binance', symbol: 'BTCUSDT' },
        });
        expect(fallback).not.toHaveBeenCalled();
    });

    it('retains a valid closed Binance interval bar beside malformed rows', async () => {
        vi.setSystemTime(now);
        const duration = 4 * 3600_000;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
            { unexpected: true }, binanceBar(now - duration, duration),
        ])));
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        expect(await getFactorCandlesWithReason('BINANCE:BTCUSDT', '4h')).toMatchObject({
            reason: null, source: { provider: 'binance' },
            candles: { t: [(now - duration) / 1000], c: [105] },
        });
        expect(fallback).not.toHaveBeenCalled();
    });

    it('preserves missing Alpaca config for CG hourly bars', async () => {
        vi.stubEnv('ALPACA_API_KEY', '');
        const fetcher = vi.fn().mockResolvedValue(response({ symbol: 'btc' }));
        vi.stubGlobal('fetch', fetcher);
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        expect(await getFactorCandlesWithReason('CG:bitcoin', '12h')).toMatchObject({
            candles: null, reason: 'missing-config', source: { provider: 'alpaca', timeZone: 'UTC' },
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fallback).not.toHaveBeenCalled();
    });

    it.each(['BINANCE:BTCUSDT', 'CG:bitcoin'])('isolates %s interval caches and deduplicates concurrent requests', async (symbol) => {
        vi.setSystemTime(now);
        const fetcher = vi.fn(async (url: string) => url.includes('api.coingecko.com')
            ? response({ symbol: 'btc' }) : url.includes('binance')
                ? response([binanceBar(now - 86400_000, 4 * 3600_000)])
                : response({ bars: { 'BTC/USD': [alpacaBar(now - 86400_000)] } }));
        vi.stubGlobal('fetch', fetcher);
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        for (const [interval] of intervals) {
            const results = await Promise.all([getFactorCandlesWithReason(symbol, interval), getFactorCandlesWithReason(symbol, interval)]);
            expect(results[0].candles).not.toBeNull();
            expect(results[0]).toEqual(results[1]);
            await getFactorCandlesWithReason(symbol, interval);
        }
        const requests = fetcher.mock.calls.filter(([url]) => !url.includes('api.coingecko.com'));
        expect(requests).toHaveLength(3);
        expect(requests.map(([url]) => new URL(url).searchParams.get(symbol.startsWith('CG:') ? 'timeframe' : 'interval')))
            .toEqual(symbol.startsWith('CG:') ? ['4Hour', '8Hour', '12Hour'] : ['4h', '8h', '12h']);
    });

    it.each(['BINANCE:BTCUSDT', 'CG:bitcoin'])('returns short %s history with missing volume without daily fallback', async (symbol) => {
        const fetcher = vi.fn(async (url: string) => url.includes('api.coingecko.com')
            ? response({ symbol: 'btc' }) : url.includes('binance')
                ? response([binanceBar(now - 86400_000, 4 * 3600_000, null)])
                : response({ bars: { 'BTC/USD': [alpacaBar(now - 86400_000, null)] } }));
        vi.stubGlobal('fetch', fetcher);
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        expect(await getFactorCandlesWithReason(symbol, '4h')).toMatchObject({
            reason: null, candles: { c: [105], volumeComplete: false },
        });
        expect(fallback).not.toHaveBeenCalled();
    });

    it.each(['BINANCE:BTCUSDT', 'CG:bitcoin'])('preserves %s API errors without fallback', async (symbol) => {
        const fetcher = vi.fn(async (url: string) => url.includes('api.coingecko.com')
            ? response({ symbol: 'btc' }) : response({}, 429));
        vi.stubGlobal('fetch', fetcher);
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        expect(await getFactorCandlesWithReason(symbol, '8h')).toMatchObject({ candles: null, reason: 'api-error' });
        expect(fetcher).toHaveBeenCalledTimes(symbol.startsWith('CG:') ? 2 : 1);
        expect(fallback).not.toHaveBeenCalled();
    });

    it('rejects non-crypto hourly symbols without contacting any provider', async () => {
        const fetcher = vi.fn();
        vi.stubGlobal('fetch', fetcher);
        const { getFactorCandlesWithReason } = await import('./alpaca.actions');
        expect(await getFactorCandlesWithReason('AAPL', '4h')).toMatchObject({ candles: null, reason: 'unsupported-symbol' });
        expect(fetcher).not.toHaveBeenCalled();
        expect(fallback).not.toHaveBeenCalled();
    });

    it('uses separate 800-day factor and 400-day vote daily histories', async () => {
        const fetcher = vi.fn().mockResolvedValue(response([BAR]));
        vi.stubGlobal('fetch', fetcher);
        const { getFactorCandlesWithReason, getDailyCandlesWithReason } = await import('./alpaca.actions');
        expect((await getFactorCandlesWithReason('BINANCE:BTCUSDT', '1d')).reason).toBeNull();
        expect((await getDailyCandlesWithReason('BINANCE:BTCUSDT', 400)).reason).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(2);
        const starts = fetcher.mock.calls.map(([url]) => Number(new URL(url).searchParams.get('startTime')));
        const now = Date.now();
        const day = 86400_000;
        expect(starts).toEqual([
            Math.floor(now / day) * day - 800 * day,
            Math.floor(now / day) * day - 400 * day,
        ]);
        expect(fetcher.mock.calls.every(([url]) => new URL(url).searchParams.get('interval') === '1d')).toBe(true);
    });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('market-aware daily candles', () => {
    it('retains primary no-data when an unavailable fallback has no better evidence', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ bars: [] })));
        const { getDailyCandlesWithReason } = await import('./alpaca.actions');
        expect(await getDailyCandlesWithReason('AAPL')).toMatchObject({ candles: null, reason: 'no-data', source: { provider: 'alpaca' } });
    });
    it('loads the actual Crypto-tab BTCUSDT pair through Binance, never a stock endpoint', async () => {
        const fetcher = vi.fn(async (url: string) => url.startsWith('https://data-api.binance.vision/api/v3/klines')
            ? response([BAR]) : response({ error: 'wrong market' }, 400));
        vi.stubGlobal('fetch', fetcher);
        const { getDailyCandles } = await import('./alpaca.actions');
        expect(await getDailyCandles('BINANCE:BTCUSDT')).toMatchObject({ c: [105], t: [1791504000], v: [123.4] });
        expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('symbol')).toBe('BTCUSDT');
        expect(fallback).not.toHaveBeenCalled();
    });

    it('routes Taiwan daily candles to official provider by default', async () => {
        const { createInMemoryTaiwanRepository } = await import('@/lib/taiwan/repository');
        const { setTaiwanRepositoryForTesting } = await import('@/lib/taiwan/reads');
        const repo = createInMemoryTaiwanRepository();
        setTaiwanRepositoryForTesting(repo);
        try {
            await repo.writeCatalog([
                {
                    exchange: 'TWSE', code: '2330', symbol: 'TWSE:2330', name: '台積電',
                    kind: 'stock', currency: 'TWD', listingDate: '1994-09-05', status: 'active',
                    metadata: {}, source: 'twse', asof: '2026-10-13',
                },
                {
                    exchange: 'TPEX', code: '6488', symbol: 'TPEX:6488', name: '環球晶',
                    kind: 'stock', currency: 'TWD', listingDate: '2015-09-25', status: 'active',
                    metadata: {}, source: 'tpex', asof: '2026-10-13',
                },
            ]);
            await repo.writeBars([
                {
                    exchange: 'TWSE', code: '2330', tradingDate: '2026-10-12',
                    t: Date.parse('2026-10-12T00:00:00+08:00'), o: 100, h: 105, l: 98, c: 103,
                    v: 5000000, change: 3, complete: true, source: 'twse',
                    priceBasis: 'unadjusted', fetchedAt: new Date().toISOString(),
                },
                {
                    exchange: 'TPEX', code: '6488', tradingDate: '2026-10-12',
                    t: Date.parse('2026-10-12T00:00:00+08:00'), o: 80, h: 85, l: 79, c: 84,
                    v: 2000000, change: 4, complete: true, source: 'tpex',
                    priceBasis: 'unadjusted', fetchedAt: new Date().toISOString(),
                },
            ]);
            const { getDailyCandlesWithReason } = await import('./alpaca.actions');
            const twseRes = await getDailyCandlesWithReason('2330.TW');
            expect(twseRes).toMatchObject({
                reason: null,
                source: { provider: 'twse', symbol: '2330', timeZone: 'Asia/Taipei', priceBasis: 'unadjusted' },
                candles: { c: [103], v: [5000000] },
            });
            const tpexRes = await getDailyCandlesWithReason('6488.TWO');
            expect(tpexRes).toMatchObject({
                reason: null,
                source: { provider: 'tpex', symbol: '6488', timeZone: 'Asia/Taipei', priceBasis: 'unadjusted' },
                candles: { c: [84], v: [2000000] },
            });
        } finally {
            setTaiwanRepositoryForTesting(null);
        }
    });

    it.each([
        ['2330.TW', '2330'], ['TWSE:2330', '2330'],
        ['6488.TWO', '6488'], ['TPEX:6488', '6488'], ['0050.TW', '0050'],
    ])('loads %s from Taiwan daily data through legacy FinMind when configured', async (symbol, stockId) => {
        vi.stubEnv('TAIWAN_CANDLE_PROVIDER', 'finmind');
        const fetcher = vi.fn(async (url: string) => url.startsWith('https://api.finmindtrade.com/api/v4/data')
            ? response({ status: 200, msg: 'success', data: [{ ...FINMIND_ROW, stock_id: stockId }] })
            : response({}, 400));
        vi.stubGlobal('fetch', fetcher);
        const { getDailyCandles } = await import('./alpaca.actions');
        expect(await getDailyCandles(symbol)).toMatchObject({ c: [105], v: [1234000], t: [1791475200] });
        expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('data_id')).toBe(stockId);
        expect(fallback).not.toHaveBeenCalled();
    });

    it('does not require Alpaca credentials for Binance or FinMind', async () => {
        vi.stubEnv('TAIWAN_CANDLE_PROVIDER', 'finmind');
        vi.stubEnv('ALPACA_API_KEY', '');
        vi.stubEnv('ALPACA_API_SECRET', '');
        vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('binance')
            ? [BAR] : { status: 200, data: [FINMIND_ROW] })));
        const { getDailyCandles } = await import('./alpaca.actions');
        expect(await getDailyCandles('BINANCE:BTCUSDT')).not.toBeNull();
        expect(await getDailyCandles('2330.TW')).not.toBeNull();
    });

    it('excludes open candles, invalid prices, sorts and deduplicates without zero-filling', async () => {
        const later = [1791590400000, '105', '110', '101', '107', '5', 1791676799999];
        const open = [1791849600000, '107', '111', '105', '110', '5', 1791935999999];
        const bad = [1791676800000, null, '110', '101', '0', '5', 1791763199999];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([later, BAR, BAR, open, bad])));
        const { getDailyCandles } = await import('./alpaca.actions');
        expect(await getDailyCandles('BINANCE:BTCUSDT')).toMatchObject({ c: [105, 107], t: [1791504000, 1791590400] });
    });

    it('shares in-flight requests and retries after a short failure cooldown', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(response({ msg: 'limited' }, 429))
            .mockResolvedValue(response([BAR]));
        vi.stubGlobal('fetch', fetcher);
        const { getDailyCandles } = await import('./alpaca.actions');
        expect(await Promise.all([getDailyCandles('BINANCE:BTCUSDT'), getDailyCandles('BINANCE:BTCUSDT')])).toEqual([null, null]);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(await getDailyCandles('BINANCE:BTCUSDT')).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(1);
        vi.setSystemTime(new Date('2026-10-13T02:01:01Z'));
        expect(await getDailyCandles('BINANCE:BTCUSDT')).not.toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('preserves Finnhub fallback for other exchanges without sending them to Alpaca', async () => {
        const fetcher = vi.fn();
        vi.stubGlobal('fetch', fetcher);
        const { getDailyCandles } = await import('./alpaca.actions');
        await getDailyCandles('0700.HK');
        expect(fetcher).not.toHaveBeenCalled();
        expect(fallback).toHaveBeenCalledWith('0700.HK', 'D', 400);
    });

    it.each([
        [429, { msg: 'limited' }, 'api-error'],
        [403, { msg: 'blocked public endpoint' }, 'api-error'],
        [400, { code: -1121, msg: 'Invalid symbol.' }, 'unsupported-symbol'],
        [200, [], 'no-data'],
        [200, { unexpected: true }, 'api-error'],
        [200, [[0, 'bad', 'bad', 'bad', 'bad', 'bad', 1]], 'api-error'],
    ])('reports Binance status %s honestly (%s)', async (status, data, reason) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data, status)));
        const { getDailyCandlesWithReason } = await import('./alpaca.actions');
        expect(await getDailyCandlesWithReason('BINANCE:BTCUSDT')).toMatchObject({ candles: null, reason });
    });

    it('classifies timeouts as API errors rather than short history', async () => {
        vi.stubEnv('TAIWAN_CANDLE_PROVIDER', 'finmind');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
        const { getDailyCandlesWithReason } = await import('./alpaca.actions');
        expect(await getDailyCandlesWithReason('2330.TW')).toMatchObject({ candles: null, reason: 'api-error' });
    });

    it('sends optional FinMind token in headers, with Taipei date boundaries', async () => {
        vi.stubEnv('TAIWAN_CANDLE_PROVIDER', 'finmind');
        vi.stubEnv('FINMIND_API_TOKEN', 'private-test-token');
        vi.setSystemTime(new Date('2026-10-12T18:00:00Z'));
        const fetcher = vi.fn().mockResolvedValue(response({ status: 200, data: [FINMIND_ROW] }));
        vi.stubGlobal('fetch', fetcher);
        const { getDailyCandlesWithReason } = await import('./alpaca.actions');
        expect(await getDailyCandlesWithReason('2330.TW')).toMatchObject({
            source: { provider: 'finmind', timeZone: 'Asia/Taipei', priceBasis: 'unadjusted' }, reason: null,
        });
        const [url, init] = fetcher.mock.calls[0];
        expect(new URL(url).searchParams.get('end_date')).toBe('2026-10-13');
        expect(url).not.toContain('private-test-token');
        expect(init.headers.Authorization).toBe('Bearer private-test-token');
    });

    it('rejects FinMind payload errors even when HTTP is 200', async () => {
        vi.stubEnv('TAIWAN_CANDLE_PROVIDER', 'finmind');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 401, msg: 'invalid token', data: [] })));
        const { getDailyCandlesWithReason } = await import('./alpaca.actions');
        expect(await getDailyCandlesWithReason('2330.TW')).toMatchObject({ candles: null, reason: 'missing-config' });
    });

    it('filters invalid Taiwan dates and missing prices without inventing candles', async () => {
        vi.stubEnv('TAIWAN_CANDLE_PROVIDER', 'finmind');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 200, data: [
            FINMIND_ROW, { ...FINMIND_ROW, date: '2026-02-30' },
            { ...FINMIND_ROW, date: '2026-10-08', open: null },
            { ...FINMIND_ROW, date: '2026-10-07', stock_id: '9999' },
        ] })));
        const { getDailyCandles } = await import('./alpaca.actions');
        expect(await getDailyCandles('2330.TW')).toMatchObject({ c: [105], t: [1791475200] });
    });
});
