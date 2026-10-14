import { describe, expect, it, vi } from 'vitest';
import {
    createInMemoryTaiwanRepository,
    createMongoTaiwanRepository,
} from './repository';
import { TaiwanSourceError } from './types';
import type { TaiwanBar, TaiwanDetails, TaiwanHistoryStatus, TaiwanSecurity } from './types';
import { TaiwanSecurityModel } from '../../database/models/taiwan-security.model';
import { TaiwanBarModel } from '../../database/models/taiwan-bar.model';
import { TaiwanDatasetModel } from '../../database/models/taiwan-dataset.model';
import { TaiwanSyncModel } from '../../database/models/taiwan-sync.model';
import { TaiwanUsageModel } from '../../database/models/taiwan-usage.model';

vi.mock('@/database/mongoose', () => ({
    connectToDatabase: vi.fn().mockResolvedValue({}),
}));

describe('TaiwanRepository (In-Memory)', () => {
    it('preserves automatic history period identities through the real Mongo schema', () => {
        const doc = new TaiwanSyncModel({ jobKey: 'history:TPEX:6488', historyStatus: {
            state: 'partial', completed: 2, total: 570, candleCount: 2, reason: null,
            completedPeriods: ['2026-10-13', '2026-10-12'], asof: '2026-10-13', checkedAt: '2026-10-14T03:00:00Z',
        } });
        expect(doc.toObject().historyStatus).toMatchObject({
            completedPeriods: ['2026-10-13', '2026-10-12'], asof: '2026-10-13', checkedAt: '2026-10-14T03:00:00Z',
        });
    });

    it('writes and reads bars, upserting duplicate day to a single corrected record', async () => {
        const repo = createInMemoryTaiwanRepository();
        const initialBar: TaiwanBar = {
            exchange: 'TWSE',
            code: '2330',
            tradingDate: '2026-10-14',
            t: 1791964800000,
            o: 1000,
            h: 1010,
            l: 995,
            c: 1005,
            v: 30000000,
            change: 5,
            complete: true,
            source: 'twse',
            priceBasis: 'unadjusted',
            fetchedAt: '2026-10-14T14:30:00.000Z',
        };

        await repo.writeBars([initialBar]);

        // Same security and date rewritten with correction
        const correctedBar: TaiwanBar = {
            ...initialBar,
            c: 1008,
            change: 8,
            fetchedAt: '2026-10-14T16:00:00.000Z',
        };
        await repo.writeBars([correctedBar]);

        const bars = await repo.readBars({ exchange: 'TWSE', code: '2330' });
        expect(bars).toHaveLength(1);
        expect(bars[0].c).toBe(1008);
        expect(bars[0].change).toBe(8);
        expect(bars[0].fetchedAt).toBe('2026-10-14T16:00:00.000Z');
    });

    it('filters bars by date range from and through', async () => {
        const repo = createInMemoryTaiwanRepository();
        const bars: TaiwanBar[] = [
            {
                exchange: 'TWSE',
                code: '2330',
                tradingDate: '2026-10-10',
                t: 1791619200000,
                o: 1000,
                h: 1000,
                l: 1000,
                c: 1000,
                v: 100,
                change: 0,
                complete: true,
                source: 'twse',
                priceBasis: 'unadjusted',
                fetchedAt: '2026-10-10T14:30:00.000Z',
            },
            {
                exchange: 'TWSE',
                code: '2330',
                tradingDate: '2026-10-11',
                t: 1791705600000,
                o: 1010,
                h: 1010,
                l: 1010,
                c: 1010,
                v: 100,
                change: 10,
                complete: true,
                source: 'twse',
                priceBasis: 'unadjusted',
                fetchedAt: '2026-10-11T14:30:00.000Z',
            },
            {
                exchange: 'TWSE',
                code: '2330',
                tradingDate: '2026-10-12',
                t: 1791792000000,
                o: 1020,
                h: 1020,
                l: 1020,
                c: 1020,
                v: 100,
                change: 10,
                complete: true,
                source: 'twse',
                priceBasis: 'unadjusted',
                fetchedAt: '2026-10-12T14:30:00.000Z',
            },
        ];
        await repo.writeBars(bars);

        const filtered = await repo.readBars(
            { exchange: 'TWSE', code: '2330' },
            '2026-10-11',
            '2026-10-11'
        );
        expect(filtered).toHaveLength(1);
        expect(filtered[0].tradingDate).toBe('2026-10-11');
    });

    it('preserves complete bar status and fetchedAt when an incomplete or older bar is written', async () => {
        const repo = createInMemoryTaiwanRepository();
        const completedBar: TaiwanBar = {
            exchange: 'TWSE',
            code: '2330',
            tradingDate: '2026-10-14',
            t: 1791964800000,
            o: 1000,
            h: 1010,
            l: 995,
            c: 1005,
            v: 30000000,
            change: 5,
            complete: true,
            source: 'twse',
            priceBasis: 'unadjusted',
            fetchedAt: '2026-10-14T15:00:00.000Z',
        };
        await repo.writeBars([completedBar]);

        // Attempt to write an incomplete bar for the same day (e.g. from a partial feed)
        const incompleteBar: TaiwanBar = {
            ...completedBar,
            complete: false,
            fetchedAt: '2026-10-14T14:00:00.000Z',
        };
        await repo.writeBars([incompleteBar]);

        const bars = await repo.readBars({ exchange: 'TWSE', code: '2330' });
        expect(bars).toHaveLength(1);
        expect(bars[0].complete).toBe(true);
        expect(bars[0].fetchedAt).toBe('2026-10-14T15:00:00.000Z');
    });

    it('rejects older incomplete bar over newer incomplete bar, but allows older complete bar to upgrade incomplete bar', async () => {
        const repo = createInMemoryTaiwanRepository();
        const baseBar: TaiwanBar = {
            exchange: 'TWSE',
            code: '2330',
            tradingDate: '2026-10-14',
            t: 1791964800000,
            o: 1000,
            h: 1010,
            l: 995,
            c: 1005,
            v: 30000000,
            change: 5,
            complete: false,
            source: 'twse',
            priceBasis: 'unadjusted',
            fetchedAt: '2026-10-14T14:30:00.000Z',
        };
        await repo.writeBars([baseBar]);

        // 1. Older incomplete bar should be ignored
        const olderIncompleteBar: TaiwanBar = {
            ...baseBar,
            c: 999,
            complete: false,
            fetchedAt: '2026-10-14T14:00:00.000Z',
        };
        await repo.writeBars([olderIncompleteBar]);
        let bars = await repo.readBars({ exchange: 'TWSE', code: '2330' });
        expect(bars[0].c).toBe(1005);
        expect(bars[0].complete).toBe(false);

        // 2. Older complete bar should upgrade complete status
        const olderCompleteBar: TaiwanBar = {
            ...baseBar,
            c: 1002,
            complete: true,
            fetchedAt: '2026-10-14T14:00:00.000Z',
        };
        await repo.writeBars([olderCompleteBar]);
        bars = await repo.readBars({ exchange: 'TWSE', code: '2330' });
        expect(bars[0].complete).toBe(true);
        expect(bars[0].fetchedAt).toBe('2026-10-14T14:30:00.000Z');
    });

    it('manages atomic job leases: single winner, non-owner release rejected, expired lease reclaimable', async () => {
        const repo = createInMemoryTaiwanRepository();
        const jobKey = 'sync-taiwan-close';

        // First claim succeeds
        const claim1 = await repo.claimJob(jobKey, 'instance-a', 500);
        expect(claim1).toBe(true);

        // Second instance cannot claim active lease
        const claim2 = await repo.claimJob(jobKey, 'instance-b', 500);
        expect(claim2).toBe(false);

        // Non-owner cannot release the job
        await repo.releaseJob(jobKey, 'instance-b');
        const claim3 = await repo.claimJob(jobKey, 'instance-c', 500);
        expect(claim3).toBe(false);

        // Owner releases the job
        await repo.releaseJob(jobKey, 'instance-a');
        const claim4 = await repo.claimJob(jobKey, 'instance-b', 500);
        expect(claim4).toBe(true);

        // Advance time beyond TTL
        vi.setSystemTime(Date.now() + 600);
        const claim5 = await repo.claimJob(jobKey, 'instance-c', 500);
        expect(claim5).toBe(true);
        vi.useRealTimers();
    });

    it('writes and reads catalog, details, dataset checkpoints, and history status', async () => {
        const repo = createInMemoryTaiwanRepository();
        const item: TaiwanSecurity = {
            exchange: 'TWSE',
            code: '2330',
            symbol: '2330',
            name: '台積電',
            kind: 'stock',
            currency: 'TWD',
            listingDate: '1994-09-05',
            status: 'active',
            metadata: { industry: '半導體業' },
            source: 'twse-companies',
            asof: '2026-10-14T00:00:00.000Z',
        };
        await repo.writeCatalog([item]);
        const catalog = await repo.readCatalog();
        expect(catalog).toHaveLength(1);
        expect(catalog[0].name).toBe('台積電');

        const details: TaiwanDetails = {
            security: item,
            fields: [{ label: '本益比', value: '25.4', period: '2026-10-14', unit: null }],
            announcements: [],
            events: [],
            asof: '2026-10-14T00:00:00.000Z',
        };
        await repo.writeDetails(details);
        const readDetails = await repo.readDetails({ exchange: 'TWSE', code: '2330' });
        expect(readDetails?.fields[0].value).toBe('25.4');

        expect(await repo.readDatasetCheckpoint('twse-stock-day-all')).toBeNull();
        await repo.writeDatasetCheckpoint('twse-stock-day-all', '2026-10-14');
        expect(await repo.readDatasetCheckpoint('twse-stock-day-all')).toBe('2026-10-14');

        const initialStatus = await repo.readHistoryStatus({ exchange: 'TWSE', code: '2330' });
        expect(initialStatus.state).toBe('disabled');

        const newStatus: TaiwanHistoryStatus = {
            state: 'ready',
            completed: 800,
            total: 800,
            candleCount: 800,
            reason: null,
        };
        await repo.writeHistoryStatus({ exchange: 'TWSE', code: '2330' }, newStatus);
        const readStatus = await repo.readHistoryStatus({ exchange: 'TWSE', code: '2330' });
        expect(readStatus.state).toBe('ready');
        expect(readStatus.candleCount).toBe(800);
    });

    it('enforces atomic usage reservation and settlement boundaries', async () => {
        const repo = createInMemoryTaiwanRepository();
        const day = '2026-10-14';
        const limits = {
            requests: 2,
            jobs: 5,
            transferBytes: 1000,
            storageBytes: 5000,
        };

        // First reservation within limits succeeds
        const res1 = await repo.reserveUsage(
            day,
            { requests: 1, jobs: 1, transferBytes: 600, storageBytes: 100 },
            limits
        );
        expect(res1).toBe(true);

        // Second reservation that would exceed transferBytes fails
        const res2 = await repo.reserveUsage(
            day,
            { requests: 1, jobs: 1, transferBytes: 500, storageBytes: 100 },
            limits
        );
        expect(res2).toBe(false);

        // Settle unused transfer bytes (e.g. refund 200 bytes)
        await repo.settleUsage(day, {
            requests: 0,
            jobs: 0,
            transferBytes: -200,
            storageBytes: 0,
        });

        // Now reserving 400 bytes succeeds (400 + 400 = 800 <= 1000)
        const res3 = await repo.reserveUsage(
            day,
            { requests: 1, jobs: 1, transferBytes: 400, storageBytes: 100 },
            limits
        );
        expect(res3).toBe(true);

        // Next reservation fails because requests limit (2) is reached
        const res4 = await repo.reserveUsage(
            day,
            { requests: 1, jobs: 0, transferBytes: 10, storageBytes: 0 },
            limits
        );
        expect(res4).toBe(false);
    });

    it('handles parallel usage reservations without exceeding limits', async () => {
        const repo = createInMemoryTaiwanRepository();
        const day = '2026-10-14';
        const limits = {
            requests: 10,
            jobs: 10,
            transferBytes: 1000,
            storageBytes: 1000,
        };

        // Attempt 20 parallel reservations of 100 bytes each (limit is 1000 bytes)
        const results = await Promise.all(
            Array.from({ length: 20 }).map(() =>
                repo.reserveUsage(
                    day,
                    { requests: 1, jobs: 0, transferBytes: 100, storageBytes: 0 },
                    limits
                )
            )
        );

        const successes = results.filter(Boolean).length;
        expect(successes).toBe(10);
    });
});

describe('Mongoose Taiwan Models & Repository Config', () => {
    it('filters persisted catalog lookups by exchange/code and treats search punctuation literally', async () => {
        const originalUri = process.env.MONGODB_URI;
        process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
        const filters: unknown[] = [];
        const find = vi.spyOn(TaiwanSecurityModel, 'find').mockImplementation(((filter: unknown) => {
            filters.push(filter);
            return { lean: async () => [] };
        }) as never);
        try {
            const repo = createMongoTaiwanRepository();
            await repo.readCatalog('2330.TW');
            expect(filters.at(-1)).toEqual({ exchange: 'TWSE', code: '2330' });
            await repo.readCatalog('6488.TWO');
            expect(filters.at(-1)).toEqual({ exchange: 'TPEX', code: '6488' });
            await repo.readCatalog('0050');
            const codeQuery = filters.at(-1) as { $or: { code?: RegExp }[] };
            expect(codeQuery.$or[0].code?.test('0050')).toBe(true);
            expect(codeQuery.$or[0].code?.test('50')).toBe(false);
            await repo.readCatalog('.*');
            const literalQuery = filters.at(-1) as { $or: { code?: RegExp }[] };
            expect(literalQuery.$or[0].code?.test('2330')).toBe(false);
            expect(literalQuery.$or[0].code?.test('.*')).toBe(true);
        } finally {
            find.mockRestore();
            if (originalUri === undefined) delete process.env.MONGODB_URI;
            else process.env.MONGODB_URI = originalUri;
        }
    });

    it('throws missing-config when MONGODB_URI is absent', async () => {
        const originalUri = process.env.MONGODB_URI;
        delete process.env.MONGODB_URI;
        try {
            const repo = createMongoTaiwanRepository();
            await expect(repo.readCatalog()).rejects.toThrow(TaiwanSourceError);
        } finally {
            if (originalUri !== undefined) {
                process.env.MONGODB_URI = originalUri;
            }
        }
    });

    it('defines unique compound indexes on all Mongoose models', () => {
        // Inspect indexes on each model's schema
        const securityIndexes = TaiwanSecurityModel.schema.indexes();
        const hasSecurityUnique = securityIndexes.some(([fields, options]) => {
            return fields.exchange === 1 && fields.code === 1 && options?.unique === true;
        });
        expect(hasSecurityUnique).toBe(true);

        const barIndexes = TaiwanBarModel.schema.indexes();
        const hasBarUnique = barIndexes.some(([fields, options]) => {
            return (
                fields.exchange === 1 &&
                fields.code === 1 &&
                fields.tradingDate === 1 &&
                fields.priceBasis === 1 &&
                options?.unique === true
            );
        });
        expect(hasBarUnique).toBe(true);

        const datasetIndexes = TaiwanDatasetModel.schema.indexes();
        const hasDatasetUnique = datasetIndexes.some(([fields, options]) => {
            return (
                fields.id === 1 &&
                fields.key === 1 &&
                fields.period === 1 &&
                options?.unique === true
            );
        });
        expect(hasDatasetUnique).toBe(true);

        const syncIndexes = TaiwanSyncModel.schema.indexes();
        const hasSyncUnique = syncIndexes.some(([fields, options]) => {
            return fields.jobKey === 1 && options?.unique === true;
        });
        expect(hasSyncUnique).toBe(true);

        const usageIndexes = TaiwanUsageModel.schema.indexes();
        const hasUsageUnique = usageIndexes.some(([fields, options]) => {
            return fields.day === 1 && options?.unique === true;
        });
        expect(hasUsageUnique).toBe(true);
    });

    it('batches MongoDB writeBars into chunks of 500, uses $in filter, and executes bulkWrite with ordered: false', async () => {
        process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
        try {
            const repo = createMongoTaiwanRepository();
            // Generate 800 bars for the same security
            const bars: TaiwanBar[] = Array.from({ length: 800 }, (_, i) => ({
                exchange: 'TWSE',
                code: '2330',
                tradingDate: `2026-01-${String(i + 1).padStart(2, '0')}`,
                t: 1767225600000 + i * 86400000,
                o: 1000 + i,
                h: 1000 + i,
                l: 1000 + i,
                c: 1000 + i,
                v: 1000,
                change: 0,
                complete: true,
                source: 'twse',
                priceBasis: 'unadjusted',
                fetchedAt: '2026-10-14T00:00:00.000Z',
            }));

            const findSpy = vi.spyOn(TaiwanBarModel, 'find').mockReturnValue({
                lean: vi.fn().mockResolvedValue([]),
            } as unknown as ReturnType<typeof TaiwanBarModel.find>);
            const bulkWriteSpy = vi
                .spyOn(TaiwanBarModel, 'bulkWrite')
                .mockResolvedValue({} as unknown as Awaited<ReturnType<typeof TaiwanBarModel.bulkWrite>>);

            await repo.writeBars(bars);

            // 800 bars should be split into 2 chunks (500 and 300)
            expect(findSpy).toHaveBeenCalledTimes(2);
            expect(bulkWriteSpy).toHaveBeenCalledTimes(2);
            expect(bulkWriteSpy).toHaveBeenCalledWith(
                expect.any(Array),
                { ordered: false }
            );

            // First call has 500 operations, second has 300
            expect(bulkWriteSpy.mock.calls[0][0]).toHaveLength(500);
            expect(bulkWriteSpy.mock.calls[1][0]).toHaveLength(300);

            findSpy.mockRestore();
            bulkWriteSpy.mockRestore();
        } finally {
            delete process.env.MONGODB_URI;
        }
    });

    it('tolerates E11000 duplicate key error in MongoDB writeBars bulkWrite', async () => {
        process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
        try {
            const repo = createMongoTaiwanRepository();
            const bar: TaiwanBar = {
                exchange: 'TWSE',
                code: '2330',
                tradingDate: '2026-10-14',
                t: 1791964800000,
                o: 1000,
                h: 1000,
                l: 1000,
                c: 1000,
                v: 1000,
                change: 0,
                complete: true,
                source: 'twse',
                priceBasis: 'unadjusted',
                fetchedAt: '2026-10-14T00:00:00.000Z',
            };

            vi.spyOn(TaiwanBarModel, 'find').mockReturnValue({
                lean: vi.fn().mockResolvedValue([]),
            } as unknown as ReturnType<typeof TaiwanBarModel.find>);
            const duplicateError = Object.assign(new Error('E11000 duplicate key error collection'), {
                code: 11000,
            });
            const bulkWriteSpy = vi.spyOn(TaiwanBarModel, 'bulkWrite').mockRejectedValue(duplicateError);

            // Should not throw because E11000 is tolerated
            await expect(repo.writeBars([bar])).resolves.not.toThrow();

            bulkWriteSpy.mockRestore();
        } finally {
            delete process.env.MONGODB_URI;
        }
    });

    it('rethrows non-E11000 errors in MongoDB writeBars bulkWrite', async () => {
        process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
        try {
            const repo = createMongoTaiwanRepository();
            const bar: TaiwanBar = {
                exchange: 'TWSE',
                code: '2330',
                tradingDate: '2026-10-14',
                t: 1791964800000,
                o: 1000,
                h: 1000,
                l: 1000,
                c: 1000,
                v: 1000,
                change: 0,
                complete: true,
                source: 'twse',
                priceBasis: 'unadjusted',
                fetchedAt: '2026-10-14T00:00:00.000Z',
            };

            vi.spyOn(TaiwanBarModel, 'find').mockReturnValue({
                lean: vi.fn().mockResolvedValue([]),
            } as unknown as ReturnType<typeof TaiwanBarModel.find>);
            const bulkWriteSpy = vi.spyOn(TaiwanBarModel, 'bulkWrite').mockRejectedValue(new Error('Connection lost'));

            await expect(repo.writeBars([bar])).rejects.toThrow('Connection lost');

            bulkWriteSpy.mockRestore();
        } finally {
            delete process.env.MONGODB_URI;
        }
    });

    it('uses pipeline update with $max [0, ...] in MongoDB settleUsage', async () => {
        process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
        try {
            const repo = createMongoTaiwanRepository();
            const updateOneSpy = vi
                .spyOn(TaiwanUsageModel, 'updateOne')
                .mockResolvedValue({} as unknown as Awaited<ReturnType<typeof TaiwanUsageModel.updateOne>>);

            await repo.settleUsage('2026-10-14', {
                requests: 0,
                jobs: 0,
                transferBytes: -5000,
                storageBytes: 0,
            });

            expect(updateOneSpy).toHaveBeenCalledWith(
                { day: '2026-10-14' },
                expect.arrayContaining([
                    expect.objectContaining({
                        $set: expect.objectContaining({
                            transferBytes: expect.objectContaining({
                                $max: [0, expect.anything()],
                            }),
                        }),
                    }),
                ])
            );

            updateOneSpy.mockRestore();
        } finally {
            delete process.env.MONGODB_URI;
        }
    });
});
