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

    it.each([
        ['2330.TW', '2330'], ['TWSE:2330', '2330'],
        ['6488.TWO', '6488'], ['TPEX:6488', '6488'], ['0050.TW', '0050'],
    ])('loads %s from Taiwan daily data while preserving its stock ID', async (symbol, stockId) => {
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
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
        const { getDailyCandlesWithReason } = await import('./alpaca.actions');
        expect(await getDailyCandlesWithReason('2330.TW')).toMatchObject({ candles: null, reason: 'api-error' });
    });

    it('sends optional FinMind token in headers, with Taipei date boundaries', async () => {
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
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 401, msg: 'invalid token', data: [] })));
        const { getDailyCandlesWithReason } = await import('./alpaca.actions');
        expect(await getDailyCandlesWithReason('2330.TW')).toMatchObject({ candles: null, reason: 'missing-config' });
    });

    it('filters invalid Taiwan dates and missing prices without inventing candles', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 200, data: [
            FINMIND_ROW, { ...FINMIND_ROW, date: '2026-02-30' },
            { ...FINMIND_ROW, date: '2026-10-08', open: null },
            { ...FINMIND_ROW, date: '2026-10-07', stock_id: '9999' },
        ] })));
        const { getDailyCandles } = await import('./alpaca.actions');
        expect(await getDailyCandles('2330.TW')).toMatchObject({ c: [105], t: [1791475200] });
    });
});
