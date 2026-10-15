import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ repository: vi.fn() }));
vi.mock('@/lib/taiwan/repository', async importOriginal => ({
    ...await importOriginal<typeof import('@/lib/taiwan/repository')>(),
    createMongoTaiwanRepository: () => state.repository(),
}));
vi.mock('@/lib/better-auth/auth', () => ({ getSession: async () => ({ user: { id: 'test-user' } }), requireUserId: async () => 'test-user' }));
vi.mock('@/lib/actions/watchlist.actions', () => ({ isStockInWatchlist: async () => false }));

function response(data: unknown) { return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }); }
const officialFetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('t187ap03_L')) return response([{ '公司代號': '2330', '公司簡稱': '台積電', '普通股每股面額': '新台幣10元', '出表日期': '1151014' }]);
    if (url.includes('t187ap47_L')) return response([{ '基金代號': '0050', '基金簡稱': '元大台灣50', '出表日期': '1151014' }]);
    if (url.includes('etfFilter')) return response({ data: [] });
    if (url.includes('STOCK_DAY?')) {
        const date = new URL(url).searchParams.get('date')!;
        const code = new URL(url).searchParams.get('stockNo')!;
        const prices = code === '0050' ? ['44', '46', '43', '45', '1'] : ['100', '105', '99', '104', '4'];
        return response({ stat: 'OK', date, title: `${code} 商品`, fields: ['日期', '成交股數', '開盤價', '最高價', '最低價', '收盤價', '漲跌價差'],
            data: [[`${Number(date.slice(0, 4)) - 1911}/${date.slice(4, 6)}/01`, '1,200,001', ...prices]] });
    }
    return response([]);
});

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T03:00:00Z'));
    vi.stubGlobal('fetch', officialFetch);
    vi.stubEnv('TAIWAN_HISTORY_ENABLED', 'false');
    vi.stubEnv('TAIWAN_AUTO_SYNC_ENABLED', 'false');
    vi.stubEnv('TAIWAN_UPSTREAM_MIN_INTERVAL_MS', '0');
    vi.stubEnv('FINNHUB_API_KEY', '');
    vi.stubEnv('FINNHUB_API_KEYS', '');
    vi.stubEnv('NEXT_PUBLIC_FINNHUB_API_KEY', '');
    const { createInMemoryTaiwanRepository } = await import('@/lib/taiwan/repository');
    const repo = createInMemoryTaiwanRepository();
    state.repository.mockReturnValue(repo);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('production entrypoints without manual initialization', () => {
    it('searches persisted stocks and ETFs after history quota exhaustion on a new instance', async () => {
        const original = await import('@/lib/actions/finnhub.actions');
        expect((await original.searchStocksWithStatus('2330')).error).toBeNull();
        const repo = state.repository();
        const read = repo.readCatalog.bind(repo);
        repo.readCatalog = async (query?: string) => {
            if (!query) throw new Error('Full catalog download unavailable');
            return read(query);
        };
        repo.reserveUsage = async () => false;
        vi.resetModules();
        officialFetch.mockClear();
        const fresh = await import('@/lib/actions/finnhub.actions');
        expect((await fresh.searchStocksWithStatus('2330')).stocks[0]?.symbol).toBe('TWSE:2330');
        expect((await fresh.searchStocksWithStatus('0050')).stocks[0]?.symbol).toBe('TWSE:0050');
        expect(officialFetch).not.toHaveBeenCalled();
    });

    it('reports the daily budget limit for an uncached search instead of a generic catalog failure', async () => {
        state.repository().reserveUsage = async () => false;
        const { searchStocksWithStatus } = await import('@/lib/actions/finnhub.actions');
        const result = await searchStocksWithStatus('2330');
        expect(result.stocks).toEqual([]);
        expect(result.error).toContain('額度');
        expect(officialFetch).not.toHaveBeenCalled();
    });
    it('searches 2330 and 0050 in an empty database without Finnhub or background flags', async () => {
        const { searchStocksWithStatus } = await import('@/lib/actions/finnhub.actions');
        const stock = await searchStocksWithStatus('2330');
        const etf = await searchStocksWithStatus('0050');
        expect(stock.error).toBeNull();
        expect(stock.stocks[0]).toMatchObject({ symbol: 'TWSE:2330', name: '台積電' });
        expect(etf.stocks[0]).toMatchObject({ symbol: 'TWSE:0050', type: 'ETF' });
        expect((await state.repository().readCatalog()).length).toBe(2);
    });

    it('opens 2330.TW with official price, source date and progressive history', async () => {
        const { getTaiwanPageData } = await import('@/lib/actions/taiwan.actions');
        const data = await getTaiwanPageData('2330.TW');
        expect(data.security?.name).toBe('台積電');
        expect(data.quote).toMatchObject({ price: 104, currency: 'TWD', source: 'twse', tradingDate: '2026-10-01' });
        expect(data.history.status).toMatchObject({ state: 'partial', completed: 2 });
        expect(data.history.bars.at(-1)?.v).toBe(1200001);
    });

    it('updates the candle assessment input after another automatic batch arrives', async () => {
        const { officialTaiwanCandles } = await import('@/lib/taiwan/candles');
        const first = await officialTaiwanCandles('2330.TW', 400);
        expect(first.candles?.c).toHaveLength(2);
        vi.setSystemTime(new Date('2026-10-14T03:01:00Z'));
        const next = await officialTaiwanCandles('TWSE:2330', 400);
        expect(next.candles?.c).toHaveLength(4);
        expect(next.source?.provider).toBe('twse');
    });

    it('loads the ETF closing price with its leading-zero identifier intact', async () => {
        const { getTaiwanPageData } = await import('@/lib/actions/taiwan.actions');
        const data = await getTaiwanPageData('0050.TW');
        expect(data.security).toMatchObject({ code: '0050', kind: 'etf' });
        expect(data.quote).toMatchObject({ price: 45, currency: 'TWD' });
        expect(data.details?.fields.some(f => f.label.includes('本益比'))).toBe(false);
    });

    it('does not start new upstream requests if the shared quota ledger is unavailable', async () => {
        state.repository().reserveUsage = async () => { throw new Error('ledger unavailable'); };
        const { searchStocksWithStatus } = await import('@/lib/actions/finnhub.actions');
        const result = await searchStocksWithStatus('2330');
        expect(result.error).not.toBeNull();
        expect(officialFetch).not.toHaveBeenCalled();
    });

    it('requires a signed-in user before an automatic history action can load data', async () => {
        const auth = await import('@/lib/better-auth/auth');
        const authSpy = vi.spyOn(auth, 'requireUserId').mockRejectedValueOnce(new Error('Unauthorized'));
        const { getTaiwanHistory } = await import('@/lib/actions/taiwan.actions');
        await expect(getTaiwanHistory('TWSE:2330', 800)).rejects.toThrow('Unauthorized');
        expect(officialFetch).not.toHaveBeenCalled();
        authSpy.mockRestore();
    });
});
