import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaiwanBar, TaiwanRepository, TaiwanSecurity } from '../taiwan/types';
import { createInMemoryTaiwanRepository } from '../taiwan/repository';

let currentSessionUserId = 'user-alice';

vi.mock('@/lib/better-auth/auth', () => ({
    getSession: vi.fn().mockImplementation(async () => ({
        user: { id: currentSessionUserId, name: 'Alice', email: 'alice@example.com' },
    })),
    requireUserId: vi.fn().mockImplementation(async () => currentSessionUserId),
}));

// In-memory mock for Watchlist model
type StoredItem = {
    userId: string;
    symbol: string;
    company: string;
    addedAt: Date;
};
const watchlistStorage: StoredItem[] = [];

vi.mock('@/database/mongoose', () => ({
    connectToDatabase: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/database/models/watchlist.model', () => ({
    Watchlist: {
        find(query: { userId?: string }) {
            const list = watchlistStorage.filter((item) => !query.userId || item.userId === query.userId);
            return {
                sort: vi.fn().mockImplementation(() => Promise.resolve(list)),
            };
        },
        async findOne(query: { userId?: string; symbol?: string | { $in: string[] } }) {
            return watchlistStorage.find((item) => {
                if (query.userId && item.userId !== query.userId) return false;
                if (!query.symbol) return true;
                if (typeof query.symbol === 'string') {
                    return item.symbol.toUpperCase() === query.symbol.toUpperCase();
                }
                if ('$in' in query.symbol) {
                    const set = new Set(query.symbol.$in.map((s) => s.toUpperCase()));
                    return set.has(item.symbol.toUpperCase());
                }
                return false;
            }) ?? null;
        },
        async findOneAndUpdate(
            filter: { userId: string; symbol: string },
            update: Partial<StoredItem>,
            options?: { upsert?: boolean; new?: boolean }
        ) {
            const index = watchlistStorage.findIndex(
                (item) => item.userId === filter.userId && item.symbol === filter.symbol
            );
            if (index >= 0) {
                watchlistStorage[index] = { ...watchlistStorage[index], ...update } as StoredItem;
                return watchlistStorage[index];
            }
            if (options?.upsert) {
                const newItem: StoredItem = {
                    userId: filter.userId,
                    symbol: update.symbol || filter.symbol,
                    company: update.company || '',
                    addedAt: update.addedAt || new Date(),
                };
                watchlistStorage.push(newItem);
                return newItem;
            }
            return null;
        },
        async findOneAndDelete(filter: { userId: string; symbol: string }) {
            const index = watchlistStorage.findIndex(
                (item) => item.userId === filter.userId && item.symbol === filter.symbol
            );
            if (index >= 0) {
                const removed = watchlistStorage.splice(index, 1);
                return removed[0];
            }
            return null;
        },
        async deleteMany(filter: { userId: string; symbol: { $in: string[] } }) {
            const targetSet = new Set(filter.symbol.$in.map((s) => s.toUpperCase()));
            let count = 0;
            for (let i = watchlistStorage.length - 1; i >= 0; i--) {
                const item = watchlistStorage[i];
                if (item.userId === filter.userId && targetSet.has(item.symbol.toUpperCase())) {
                    watchlistStorage.splice(i, 1);
                    count++;
                }
            }
            return { deletedCount: count };
        },
    },
}));

vi.mock('next/cache', () => ({
    revalidatePath: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Taiwan watchlist and pricing', () => {
    let repo: TaiwanRepository;

    const sampleSecurities: TaiwanSecurity[] = [
        {
            exchange: 'TWSE',
            code: '0050',
            symbol: 'TWSE:0050',
            name: '元大台灣50',
            kind: 'etf',
            currency: 'TWD',
            listingDate: '2003-06-30',
            status: 'active',
            metadata: {},
            source: 'twse-etfs',
            asof: '2026-10-13',
        },
        {
            exchange: 'TWSE',
            code: '2330',
            symbol: 'TWSE:2330',
            name: '台積電',
            kind: 'stock',
            currency: 'TWD',
            listingDate: '1994-09-05',
            status: 'active',
            metadata: {},
            source: 'twse-companies',
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
            metadata: {},
            source: 'tpex-companies',
            asof: '2026-10-13',
        },
        {
            exchange: 'TWSE',
            code: '9999',
            symbol: 'TWSE:9999',
            name: '未知幣別股',
            kind: 'stock',
            currency: null, // unknown currency
            listingDate: '2020-01-01',
            status: 'active',
            metadata: {},
            source: 'twse-companies',
            asof: '2026-10-13',
        },
    ];

    const sampleBars: TaiwanBar[] = [
        {
            exchange: 'TWSE',
            code: '0050',
            tradingDate: '2026-10-13',
            t: 1791849600,
            o: 180,
            h: 185,
            l: 179,
            c: 184,
            v: 5000000,
            change: 4,
            complete: true,
            source: 'twse',
            priceBasis: 'unadjusted',
            fetchedAt: '2026-10-13T06:00:00Z',
        },
        {
            exchange: 'TWSE',
            code: '2330',
            tradingDate: '2026-10-13',
            t: 1791849600,
            o: 1000,
            h: 1010,
            l: 995,
            c: 1000,
            v: 20000000,
            change: 0, // Zero change!
            complete: true,
            source: 'twse',
            priceBasis: 'unadjusted',
            fetchedAt: '2026-10-13T06:00:00Z',
        },
    ];

    beforeEach(async () => {
        vi.clearAllMocks();
        watchlistStorage.length = 0;
        currentSessionUserId = 'user-alice';
        repo = createInMemoryTaiwanRepository();
        await repo.writeCatalog(sampleSecurities);
        await repo.writeBars(sampleBars);
        const { setTaiwanRepositoryForTesting } = await import('../taiwan/reads');
        setTaiwanRepositoryForTesting(repo);
    });

    afterEach(async () => {
        const { setTaiwanRepositoryForTesting } = await import('../taiwan/reads');
        setTaiwanRepositoryForTesting(null);
    });

    it('returns Taiwan watchlist row with price, TWD currency, trading date, close mode, and twse/tpex source', async () => {
        const { getWatchlistData } = await import('./finnhub.actions');

        const rows = await getWatchlistData(['TWSE:0050']);
        expect(rows).toHaveLength(1);
        const row = rows[0] as unknown as {
            symbol: string;
            price: number;
            change: number;
            changePercent: number;
            currency: string | null;
            name: string;
            source: string;
            tradingDate: string;
            mode: string;
        };

        expect(row.symbol).toBe('TWSE:0050');
        expect(row.name).toBe('元大台灣50');
        expect(row.price).toBe(184);
        expect(row.change).toBe(4);
        expect(row.currency).toBe('TWD');
        expect(row.tradingDate).toBe('2026-10-13');
        expect(row.source).toBe('twse');
        expect(row.mode).toBe('close');

        // External Finnhub quote or profile must not be called for Taiwan symbol
        const finnhubCalls = mockFetch.mock.calls.filter((call) =>
            String(call[0]).includes('finnhub.io')
        );
        expect(finnhubCalls).toHaveLength(0);
    });

    it('differentiates quote null from zero change, and does not default unknown currency to USD', async () => {
        const { getWatchlistData } = await import('./finnhub.actions');

        // TWSE:2330 has valid bar with change = 0 (zero change)
        // TPEX:6488 has no bar (null quote)
        // TWSE:9999 has no bar and currency is null (unknown currency)
        const rows = await getWatchlistData(['TWSE:2330', 'TPEX:6488', 'TWSE:9999']);
        expect(rows).toHaveLength(3);

        const row2330 = rows.find((r) => r.symbol === 'TWSE:2330')!;
        expect(row2330.price).toBe(1000);
        expect(row2330.change).toBe(0); // Zero change, not null!
        expect(row2330.changePercent).toBe(0);

        const row6488 = rows.find((r) => r.symbol === 'TPEX:6488')!;
        expect(row6488.price).toBeNull();
        expect(row6488.change).toBeNull();
        expect(row6488.changePercent).toBeNull();

        const row9999 = rows.find((r) => r.symbol === 'TWSE:9999')!;
        expect(row9999.currency).toBeNull(); // Never default to 'USD' for Taiwan stocks!
    });

    it('prevents duplicate watchlist rows when adding TWSE:2330 while 2330.TW exists, and returns existing record', async () => {
        const { addToWatchlist, getUserWatchlist, isStockInWatchlist } = await import('./watchlist.actions');

        // User adds 2330.TW
        const first = await addToWatchlist('2330.TW', '台積電');
        expect(first).toBeDefined();

        // User now adds TWSE:2330
        const second = await addToWatchlist('TWSE:2330', '台積電');
        expect(second).toBeDefined();
        // Should not insert second record
        const list = await getUserWatchlist();
        expect(list).toHaveLength(1);

        // Alias lookup in watchlist
        expect(await isStockInWatchlist('2330.TW')).toBe(true);
        expect(await isStockInWatchlist('TWSE:2330')).toBe(true);
        expect(await isStockInWatchlist('2330')).toBe(true);
    });

    it('removes all equivalent aliases for that user when removing by any alias', async () => {
        const { addToWatchlist, removeFromWatchlist, isStockInWatchlist } = await import('./watchlist.actions');

        await addToWatchlist('TWSE:2330', '台積電');
        expect(await isStockInWatchlist('2330.TW')).toBe(true);

        // Remove by 2330.TW alias
        await removeFromWatchlist('2330.TW');
        expect(await isStockInWatchlist('TWSE:2330')).toBe(false);
        expect(await isStockInWatchlist('2330.TW')).toBe(false);
        expect(await isStockInWatchlist('2330')).toBe(false);
    });

    it('enforces strict user isolation: user A cannot read or mutate user B records', async () => {
        const { addToWatchlist, getUserWatchlist, isStockInWatchlist, removeFromWatchlist } = await import(
            './watchlist.actions'
        );

        // User Alice adds TWSE:2330
        currentSessionUserId = 'user-alice';
        await addToWatchlist('TWSE:2330', '台積電');

        // Switch to User Bob
        currentSessionUserId = 'user-bob';
        expect(await isStockInWatchlist('TWSE:2330')).toBe(false);
        expect(await getUserWatchlist()).toHaveLength(0);

        // Bob tries to remove 2330.TW
        await removeFromWatchlist('2330.TW');

        // Switch back to Alice: Alice's item remains intact!
        currentSessionUserId = 'user-alice';
        expect(await isStockInWatchlist('TWSE:2330')).toBe(true);
        expect(await getUserWatchlist()).toHaveLength(1);
    });
});
