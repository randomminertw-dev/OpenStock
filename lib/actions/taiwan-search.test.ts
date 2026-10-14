import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaiwanRepository, TaiwanSecurity } from '../taiwan/types';
import { createInMemoryTaiwanRepository } from '../taiwan/repository';

// Mock session to simulate an authenticated user
vi.mock('@/lib/better-auth/auth', () => ({
    getSession: vi.fn().mockResolvedValue({
        user: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
    }),
    requireUserId: vi.fn().mockResolvedValue('test-user-id'),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Taiwan search and reads', () => {
    let repo: TaiwanRepository;

    const sampleSecurities: TaiwanSecurity[] = [
        {
            exchange: 'TWSE',
            code: '2330',
            symbol: 'TWSE:2330',
            name: '台積電',
            kind: 'stock',
            currency: 'TWD',
            listingDate: '1994-09-05',
            status: 'active',
            metadata: { fullName: '台灣積體電路製造股份有限公司' },
            source: 'twse-companies',
            asof: '2026-10-13',
        },
        {
            exchange: 'TWSE',
            code: '0050',
            symbol: 'TWSE:0050',
            name: '元大台灣50',
            kind: 'etf',
            currency: 'TWD',
            listingDate: '2003-06-30',
            status: 'active',
            metadata: { fullName: '元大台灣卓越50證券投資信託基金' },
            source: 'twse-etfs',
            asof: '2026-10-13',
        },
        {
            exchange: 'TPEX',
            code: '6488',
            symbol: 'TPEX:6488',
            name: '環球晶',
            kind: 'stock',
            currency: 'TWD',
            listingDate: '2015-09-25',
            status: 'active',
            metadata: { fullName: '環球晶圓股份有限公司' },
            source: 'tpex-companies',
            asof: '2026-10-13',
        },
    ];

    beforeEach(async () => {
        vi.clearAllMocks();
        repo = createInMemoryTaiwanRepository();
        await repo.writeCatalog(sampleSecurities);
        const { setTaiwanRepositoryForTesting } = await import('../taiwan/reads');
        setTaiwanRepositoryForTesting(repo);
    });

    afterEach(async () => {
        const { setTaiwanRepositoryForTesting } = await import('../taiwan/reads');
        setTaiwanRepositoryForTesting(null);
    });

    it('searches Taiwan stock and ETF without Finnhub API keys configured', async () => {
        vi.stubEnv('FINNHUB_API_KEYS', '');
        vi.stubEnv('NEXT_PUBLIC_FINNHUB_API_KEY', '');
        vi.stubEnv('FINNHUB_API_KEY', '');

        const { searchStocks } = await import('./finnhub.actions');

        const resultsStock = await searchStocks('2330');
        expect(resultsStock).toHaveLength(1);
        expect(resultsStock[0]).toMatchObject({
            symbol: 'TWSE:2330',
            name: '台積電',
            exchange: 'TWSE',
            type: 'Stock',
            isInWatchlist: false,
        });

        const resultsEtf = await searchStocks('0050');
        expect(resultsEtf).toHaveLength(1);
        expect(resultsEtf[0]).toMatchObject({
            symbol: 'TWSE:0050',
            name: '元大台灣50',
            exchange: 'TWSE',
            type: 'ETF',
            isInWatchlist: false,
        });

        // External Finnhub API should never have been contacted
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not send bare Taiwan numbers (e.g. 2330, 0050, 6488) to Finnhub US search even if Finnhub keys exist', async () => {
        vi.stubEnv('FINNHUB_API_KEYS', 'dummy-key');
        const { searchStocks } = await import('./finnhub.actions');

        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ count: 0, result: [] }),
        });

        const res2330 = await searchStocks('2330');
        expect(res2330.some((r) => r.symbol === 'TWSE:2330')).toBe(true);

        const res6488 = await searchStocks('6488');
        expect(res6488.some((r) => r.symbol === 'TPEX:6488')).toBe(true);

        // Neither 2330 nor 6488 should have called Finnhub URL
        const finnhubCalls = mockFetch.mock.calls.filter((call) =>
            String(call[0]).includes('finnhub.io')
        );
        expect(finnhubCalls).toHaveLength(0);
    });

    it('hits Taiwan securities with Chinese queries and does not call Finnhub', async () => {
        vi.stubEnv('FINNHUB_API_KEYS', 'dummy-key');
        const { searchStocks } = await import('./finnhub.actions');

        const results = await searchStocks('台積電');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].symbol).toBe('TWSE:2330');

        const finnhubCalls = mockFetch.mock.calls.filter((call) =>
            String(call[0]).includes('finnhub.io')
        );
        expect(finnhubCalls).toHaveLength(0);
    });

    it('does not claim "no products" or trigger external API when Taiwan DB is uninitialized or fails', async () => {
        // Create a failing repo that throws DB error
        const failingRepo: TaiwanRepository = {
            ...createInMemoryTaiwanRepository(),
            async readCatalog() {
                throw new Error('MongoNetworkError: connection refused');
            },
        };
        const { setTaiwanRepositoryForTesting } = await import('../taiwan/reads');
        setTaiwanRepositoryForTesting(failingRepo);

        vi.stubEnv('FINNHUB_API_KEYS', 'dummy-key');
        const { searchStocks } = await import('./finnhub.actions');

        // Searching 2330 while DB fails must not call Finnhub
        let thrownError: unknown = null;
        try {
            await searchStocks('2330');
        } catch (e) {
            thrownError = e;
        }

        const finnhubCalls = mockFetch.mock.calls.filter((call) =>
            String(call[0]).includes('finnhub.io')
        );
        expect(finnhubCalls).toHaveLength(0);

        // It must NOT quietly return [] claiming "nothing matches" when the database failed
        // It should either throw a wrapped user-friendly error (not raw MongoNetworkError)
        // or communicate uninitialized status
        expect(thrownError).toBeDefined();
        expect(String(thrownError)).not.toContain('MongoNetworkError');
    });

    it('returns a serializable readiness message for an empty official catalog', async () => {
        const { setTaiwanRepositoryForTesting } = await import('../taiwan/reads');
        setTaiwanRepositoryForTesting(createInMemoryTaiwanRepository());
        const { searchStocksWithStatus } = await import('./finnhub.actions');
        const response = await searchStocksWithStatus('2330');
        expect(JSON.parse(JSON.stringify(response))).toEqual({
            stocks: [],
            error: '官方台股資料尚未初始化或暫時無法讀取，請稍後再試。',
        });
    });

    it('does not expose database errors through the search response', async () => {
        const { setTaiwanRepositoryForTesting } = await import('../taiwan/reads');
        setTaiwanRepositoryForTesting({
            ...createInMemoryTaiwanRepository(),
            async readCatalog() { throw new Error('MongoNetworkError: private-host'); },
        });
        const { searchStocksWithStatus } = await import('./finnhub.actions');
        const response = await searchStocksWithStatus('0050');
        expect(response.error).toBe('官方台股資料尚未初始化或暫時無法讀取，請稍後再試。');
        expect(JSON.stringify(response)).not.toContain('private-host');
    });

    it('preserves code search results in the structured response after initialization', async () => {
        const { searchStocksWithStatus } = await import('./finnhub.actions');
        const response = await searchStocksWithStatus('2330');
        expect(response.error).toBeNull();
        expect(response.stocks[0]).toMatchObject({ symbol: 'TWSE:2330', name: '台積電' });
    });

    it('reads Taiwan security, quote, history, and details from reads.ts repository reader', async () => {
        await repo.writeBars([
            {
                exchange: 'TWSE',
                code: '2330',
                tradingDate: '2026-10-12',
                t: 1791763200,
                o: 1000,
                h: 1010,
                l: 995,
                c: 1005,
                v: 25000000,
                change: 5,
                complete: true,
                source: 'twse',
                priceBasis: 'unadjusted',
                fetchedAt: '2026-10-12T06:00:00Z',
            },
            {
                exchange: 'TWSE',
                code: '2330',
                tradingDate: '2026-10-13',
                t: 1791849600,
                o: 1010,
                h: 1025,
                l: 1005,
                c: 1020,
                v: 30000000,
                change: 15,
                complete: true,
                source: 'twse',
                priceBasis: 'unadjusted',
                fetchedAt: '2026-10-13T06:00:00Z',
            },
        ]);

        const {
            getTaiwanSecurity,
            getTaiwanQuote,
            searchTaiwanSecurities,
            getTaiwanHistory,
            getTaiwanDetails,
        } = await import('../taiwan/reads');

        const sec = await getTaiwanSecurity('TWSE:2330');
        expect(sec?.name).toBe('台積電');
        expect(sec?.currency).toBe('TWD');

        const secAlias = await getTaiwanSecurity('2330.TW');
        expect(secAlias?.name).toBe('台積電');

        const quote = await getTaiwanQuote('TWSE:2330');
        expect(quote).toMatchObject({
            exchange: 'TWSE',
            code: '2330',
            price: 1020,
            change: 15,
            currency: 'TWD',
            tradingDate: '2026-10-13',
            source: 'twse',
            mode: 'close',
        });

        const history = await getTaiwanHistory('TWSE:2330', 5);
        expect(history.bars).toHaveLength(2);
        expect(history.bars[1].c).toBe(1020);

        const searchRes = await searchTaiwanSecurities('台積電');
        expect(searchRes).toHaveLength(1);
        expect(searchRes[0].symbol).toBe('TWSE:2330');

        const details = await getTaiwanDetails('TWSE:2330');
        expect(details?.security?.name).toBe('台積電');
    });
});
