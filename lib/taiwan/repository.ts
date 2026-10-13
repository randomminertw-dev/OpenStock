import { connectToDatabase } from '@/database/mongoose';
import { TaiwanSecurityModel } from '@/database/models/taiwan-security.model';
import { TaiwanBarModel } from '@/database/models/taiwan-bar.model';
import { TaiwanDatasetModel } from '@/database/models/taiwan-dataset.model';
import { TaiwanSyncModel } from '@/database/models/taiwan-sync.model';
import { TaiwanUsageModel } from '@/database/models/taiwan-usage.model';
import {
    TaiwanSourceError,
    type TaiwanBar,
    type TaiwanDatasetId,
    type TaiwanDetails,
    type TaiwanHistoryStatus,
    type TaiwanKey,
    type TaiwanRepository,
    type TaiwanSecurity,
    type TaiwanUsageAmounts,
    type TaiwanUsageLimits,
} from './types';

/**
 * Creates an in-memory TaiwanRepository for unit tests, local mocking, and dry runs.
 */
export function createInMemoryTaiwanRepository(): TaiwanRepository {
    const catalog = new Map<string, TaiwanSecurity>();
    const bars = new Map<string, TaiwanBar>();
    const details = new Map<string, TaiwanDetails>();
    const jobs = new Map<string, { owner: string | null; lockedUntil: number | null }>();
    const checkpoints = new Map<TaiwanDatasetId, string>();
    const historyStatuses = new Map<string, TaiwanHistoryStatus>();
    const usage = new Map<string, TaiwanUsageAmounts>();

    const makeSecKey = (k: TaiwanKey) => `${k.exchange}:${k.code}`;
    const makeBarKey = (b: TaiwanBar | TaiwanKey, date?: string, basis = 'unadjusted') =>
        'tradingDate' in b
            ? `${b.exchange}:${b.code}:${b.tradingDate}:${b.priceBasis}`
            : `${b.exchange}:${b.code}:${date}:${basis}`;

    return {
        async readCatalog(): Promise<TaiwanSecurity[]> {
            return Array.from(catalog.values());
        },

        async readBars(key: TaiwanKey, from?: string, through?: string): Promise<TaiwanBar[]> {
            const prefix = `${key.exchange}:${key.code}:`;
            const matched: TaiwanBar[] = [];
            for (const [k, bar] of bars.entries()) {
                if (!k.startsWith(prefix)) continue;
                if (from && bar.tradingDate < from) continue;
                if (through && bar.tradingDate > through) continue;
                matched.push({ ...bar });
            }
            return matched.sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
        },

        async readDetails(key: TaiwanKey): Promise<TaiwanDetails | null> {
            const found = details.get(makeSecKey(key));
            return found ? JSON.parse(JSON.stringify(found)) : null;
        },

        async writeCatalog(items: TaiwanSecurity[]): Promise<void> {
            for (const item of items) {
                catalog.set(makeSecKey(item), { ...item });
            }
        },

        async writeBars(incomingBars: TaiwanBar[]): Promise<void> {
            for (const incoming of incomingBars) {
                const barKey = makeBarKey(incoming);
                const existing = bars.get(barKey);

                if (existing) {
                    // Do not allow an incomplete or older bar to overwrite a complete, newer bar
                    if (existing.complete && !incoming.complete) {
                        continue;
                    }
                    if (existing.fetchedAt > incoming.fetchedAt && existing.complete) {
                        continue;
                    }
                    bars.set(barKey, {
                        ...incoming,
                        complete: existing.complete ? true : incoming.complete,
                        fetchedAt: existing.complete && !incoming.complete ? existing.fetchedAt : incoming.fetchedAt,
                    });
                } else {
                    bars.set(barKey, { ...incoming });
                }
            }
        },

        async writeDetails(d: TaiwanDetails): Promise<void> {
            details.set(makeSecKey(d.security), JSON.parse(JSON.stringify(d)));
        },

        async claimJob(jobKey: string, owner: string, ttlMs: number): Promise<boolean> {
            const now = Date.now();
            const existing = jobs.get(jobKey);
            if (!existing || existing.owner === null || (existing.lockedUntil !== null && existing.lockedUntil <= now)) {
                jobs.set(jobKey, { owner, lockedUntil: now + ttlMs });
                return true;
            }
            return false;
        },

        async releaseJob(jobKey: string, owner: string): Promise<void> {
            const existing = jobs.get(jobKey);
            if (existing && existing.owner === owner) {
                jobs.set(jobKey, { owner: null, lockedUntil: null });
            }
        },

        async readHistoryStatus(key: TaiwanKey): Promise<TaiwanHistoryStatus> {
            const status = historyStatuses.get(makeSecKey(key));
            return (
                status ?? {
                    state: 'disabled',
                    completed: 0,
                    total: 0,
                    candleCount: 0,
                    reason: null,
                }
            );
        },

        async writeHistoryStatus(key: TaiwanKey, status: TaiwanHistoryStatus): Promise<void> {
            historyStatuses.set(makeSecKey(key), { ...status });
        },

        async readDatasetCheckpoint(id: TaiwanDatasetId): Promise<string | null> {
            return checkpoints.get(id) ?? null;
        },

        async writeDatasetCheckpoint(id: TaiwanDatasetId, asof: string): Promise<void> {
            checkpoints.set(id, asof);
        },

        async reserveUsage(day: string, amounts: TaiwanUsageAmounts, limits: TaiwanUsageLimits): Promise<boolean> {
            const current = usage.get(day) ?? {
                requests: 0,
                jobs: 0,
                transferBytes: 0,
                storageBytes: 0,
            };

            if (
                current.requests + amounts.requests > limits.requests ||
                current.jobs + amounts.jobs > limits.jobs ||
                current.transferBytes + amounts.transferBytes > limits.transferBytes ||
                current.storageBytes + amounts.storageBytes > limits.storageBytes
            ) {
                return false;
            }

            usage.set(day, {
                requests: current.requests + amounts.requests,
                jobs: current.jobs + amounts.jobs,
                transferBytes: current.transferBytes + amounts.transferBytes,
                storageBytes: current.storageBytes + amounts.storageBytes,
            });
            return true;
        },

        async settleUsage(day: string, amounts: TaiwanUsageAmounts): Promise<void> {
            const current = usage.get(day) ?? {
                requests: 0,
                jobs: 0,
                transferBytes: 0,
                storageBytes: 0,
            };

            usage.set(day, {
                requests: Math.max(0, current.requests + amounts.requests),
                jobs: Math.max(0, current.jobs + amounts.jobs),
                transferBytes: Math.max(0, current.transferBytes + amounts.transferBytes),
                storageBytes: Math.max(0, current.storageBytes + amounts.storageBytes),
            });
        },
    };
}

/**
 * Creates a TaiwanRepository backed by MongoDB.
 * Reports missing-config if MONGODB_URI is absent or connection fails.
 */
export function createMongoTaiwanRepository(): TaiwanRepository {
    async function ensureDb() {
        if (!process.env.MONGODB_URI) {
            throw new TaiwanSourceError('missing-config', 'MongoDB URI is missing');
        }
        try {
            await connectToDatabase();
        } catch (err: unknown) {
            if (err instanceof TaiwanSourceError) throw err;
            throw new TaiwanSourceError('missing-config', (err as Error).message);
        }
    }

    return {
        async readCatalog(): Promise<TaiwanSecurity[]> {
            await ensureDb();
            const docs = await TaiwanSecurityModel.find({}).lean();
            return docs.map(doc => ({
                exchange: doc.exchange,
                code: doc.code,
                symbol: doc.symbol,
                name: doc.name,
                kind: doc.kind,
                currency: doc.currency,
                listingDate: doc.listingDate,
                status: doc.status,
                metadata: (doc.metadata as Record<string, string>) || {},
                source: doc.source,
                asof: doc.asof,
            }));
        },

        async readBars(key: TaiwanKey, from?: string, through?: string): Promise<TaiwanBar[]> {
            await ensureDb();
            const filter: Record<string, unknown> = {
                exchange: key.exchange,
                code: key.code,
            };
            if (from || through) {
                const dateFilter: Record<string, string> = {};
                if (from) dateFilter.$gte = from;
                if (through) dateFilter.$lte = through;
                filter.tradingDate = dateFilter;
            }
            const docs = await TaiwanBarModel.find(filter).sort({ tradingDate: 1 }).lean();
            return docs.map(doc => ({
                exchange: doc.exchange,
                code: doc.code,
                tradingDate: doc.tradingDate,
                t: doc.t,
                o: doc.o,
                h: doc.h,
                l: doc.l,
                c: doc.c,
                v: doc.v,
                change: doc.change,
                complete: doc.complete,
                source: doc.source,
                priceBasis: doc.priceBasis,
                fetchedAt: doc.fetchedAt,
            }));
        },

        async readDetails(key: TaiwanKey): Promise<TaiwanDetails | null> {
            await ensureDb();
            const doc = await TaiwanDatasetModel.findOne({
                id: 'details',
                key: `${key.exchange}:${key.code}`,
                period: 'latest',
            }).lean();
            return (doc?.payload as TaiwanDetails | null) ?? null;
        },

        async writeCatalog(items: TaiwanSecurity[]): Promise<void> {
            await ensureDb();
            if (items.length === 0) return;
            const ops = items.map(item => ({
                updateOne: {
                    filter: { exchange: item.exchange, code: item.code },
                    update: { $set: item },
                    upsert: true,
                },
            }));
            await TaiwanSecurityModel.bulkWrite(ops);
        },

        async writeBars(bars: TaiwanBar[]): Promise<void> {
            await ensureDb();
            for (const bar of bars) {
                const filter = {
                    exchange: bar.exchange,
                    code: bar.code,
                    tradingDate: bar.tradingDate,
                    priceBasis: bar.priceBasis,
                };
                const existing = await TaiwanBarModel.findOne(filter).lean();
                if (existing) {
                    if (existing.complete && !bar.complete) {
                        continue;
                    }
                    if (existing.fetchedAt > bar.fetchedAt && existing.complete) {
                        continue;
                    }
                    await TaiwanBarModel.updateOne(filter, {
                        $set: {
                            ...bar,
                            complete: existing.complete ? true : bar.complete,
                            fetchedAt:
                                existing.complete && !bar.complete
                                    ? existing.fetchedAt
                                    : bar.fetchedAt,
                        },
                    });
                } else {
                    await TaiwanBarModel.create(bar);
                }
            }
        },

        async writeDetails(details: TaiwanDetails): Promise<void> {
            await ensureDb();
            await TaiwanDatasetModel.findOneAndUpdate(
                {
                    id: 'details',
                    key: `${details.security.exchange}:${details.security.code}`,
                    period: 'latest',
                },
                {
                    $set: {
                        id: 'details',
                        key: `${details.security.exchange}:${details.security.code}`,
                        period: 'latest',
                        payload: details,
                        asof: details.asof,
                    },
                },
                { upsert: true }
            );
        },

        async claimJob(jobKey: string, owner: string, ttlMs: number): Promise<boolean> {
            await ensureDb();
            const now = new Date();
            const lockedUntil = new Date(now.getTime() + ttlMs);
            try {
                const res = await TaiwanSyncModel.findOneAndUpdate(
                    {
                        jobKey,
                        $or: [
                            { owner: null },
                            { lockedUntil: null },
                            { lockedUntil: { $lte: now } },
                        ],
                    },
                    {
                        $set: { owner, lockedUntil },
                    },
                    { new: true }
                );
                if (res) return true;

                // Document might not exist yet; attempt creation
                try {
                    await TaiwanSyncModel.create({
                        jobKey,
                        owner,
                        lockedUntil,
                    });
                    return true;
                } catch {
                    return false;
                }
            } catch {
                return false;
            }
        },

        async releaseJob(jobKey: string, owner: string): Promise<void> {
            await ensureDb();
            await TaiwanSyncModel.updateOne(
                { jobKey, owner },
                { $set: { owner: null, lockedUntil: null } }
            );
        },

        async readHistoryStatus(key: TaiwanKey): Promise<TaiwanHistoryStatus> {
            await ensureDb();
            const doc = await TaiwanSyncModel.findOne({
                jobKey: `history:${key.exchange}:${key.code}`,
            }).lean();
            return (
                doc?.historyStatus ?? {
                    state: 'disabled',
                    completed: 0,
                    total: 0,
                    candleCount: 0,
                    reason: null,
                }
            );
        },

        async writeHistoryStatus(key: TaiwanKey, status: TaiwanHistoryStatus): Promise<void> {
            await ensureDb();
            await TaiwanSyncModel.findOneAndUpdate(
                { jobKey: `history:${key.exchange}:${key.code}` },
                {
                    $set: {
                        jobKey: `history:${key.exchange}:${key.code}`,
                        historyStatus: status,
                    },
                },
                { upsert: true }
            );
        },

        async readDatasetCheckpoint(id: TaiwanDatasetId): Promise<string | null> {
            await ensureDb();
            const doc = await TaiwanDatasetModel.findOne({
                id,
                key: 'checkpoint',
                period: 'checkpoint',
            }).lean();
            return doc?.asof ?? null;
        },

        async writeDatasetCheckpoint(id: TaiwanDatasetId, asof: string): Promise<void> {
            await ensureDb();
            await TaiwanDatasetModel.findOneAndUpdate(
                { id, key: 'checkpoint', period: 'checkpoint' },
                { $set: { id, key: 'checkpoint', period: 'checkpoint', asof } },
                { upsert: true }
            );
        },

        async reserveUsage(day: string, amounts: TaiwanUsageAmounts, limits: TaiwanUsageLimits): Promise<boolean> {
            await ensureDb();
            await TaiwanUsageModel.updateOne(
                { day },
                {
                    $setOnInsert: {
                        day,
                        requests: 0,
                        jobs: 0,
                        transferBytes: 0,
                        storageBytes: 0,
                    },
                },
                { upsert: true }
            );

            const updated = await TaiwanUsageModel.findOneAndUpdate(
                {
                    day,
                    requests: { $lte: limits.requests - amounts.requests },
                    jobs: { $lte: limits.jobs - amounts.jobs },
                    transferBytes: { $lte: limits.transferBytes - amounts.transferBytes },
                    storageBytes: { $lte: limits.storageBytes - amounts.storageBytes },
                },
                {
                    $inc: {
                        requests: amounts.requests,
                        jobs: amounts.jobs,
                        transferBytes: amounts.transferBytes,
                        storageBytes: amounts.storageBytes,
                    },
                },
                { new: true }
            );
            return updated !== null;
        },

        async settleUsage(day: string, amounts: TaiwanUsageAmounts): Promise<void> {
            await ensureDb();
            await TaiwanUsageModel.updateOne(
                { day },
                {
                    $inc: {
                        requests: amounts.requests,
                        jobs: amounts.jobs,
                        transferBytes: amounts.transferBytes,
                        storageBytes: amounts.storageBytes,
                    },
                }
            );
        },
    };
}
