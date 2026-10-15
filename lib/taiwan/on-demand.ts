import { buildTaiwanCatalog, searchTaiwanCatalog } from './catalog';
import { buildTaiwanDetails } from './fundamentals';
import { createBudgetedRequest, getTaipeiDayString } from './budget';
import { loadTaiwanSyncConfig } from './config';
import { planTaiwanHistory } from './history';
import { fetchTaiwanDataset, fetchTaiwanHistory } from './sources';
import { TaiwanSourceError, type TaiwanBar, type TaiwanDatasetBundle, type TaiwanDatasetId,
    type TaiwanDetails, type TaiwanHistory, type TaiwanKey, type TaiwanRepository,
    type TaiwanRequester, type TaiwanSecurity, type TaiwanSyncConfig } from './types';

const DAY = 86_400_000;
const CATALOG_IDS: TaiwanDatasetId[] = ['twse-companies', 'twse-etfs', 'tpex-companies', 'tpex-etfs'];
const loaders = new WeakMap<TaiwanRepository, ReturnType<typeof createTaiwanOnDemand>>();

/** Conservative defaults apply to on-screen reads; scheduled jobs remain opt-in. */
function readConfig(): TaiwanSyncConfig {
    const configured = loadTaiwanSyncConfig();
    if (configured) return { ...configured, timeoutMs: 10000, maxRetries: 0 };
    if (Object.keys(process.env).some(k => k.startsWith('TAIWAN_MAX_') && process.env[k])) {
        const keys = ['TAIWAN_MAX_REQUESTS_PER_DAY', 'TAIWAN_MAX_JOBS_PER_DAY',
            'TAIWAN_MAX_TRANSFER_BYTES_PER_DAY', 'TAIWAN_MAX_STORAGE_BYTES',
            'TAIWAN_MAX_TRACKED_SECURITIES', 'TAIWAN_MAX_RESPONSE_BYTES'];
        const missing = keys.filter(k => !process.env[k]?.trim());
        const invalid = keys.filter(k => {
            const raw = process.env[k]?.trim();
            return !!raw && (!/^\d+$/.test(raw) || !Number.isInteger(Number(raw)) || Number(raw) <= 0);
        });
        console.warn('[taiwan-data]', { event: 'limits-invalid', missing, invalid });
        throw new TaiwanSourceError('missing-config', 'Invalid Taiwan limits');
    }
    return { autoSyncEnabled: false, historyEnabled: false, maxRequestsPerDay: 200,
        maxJobsPerDay: 100, maxTransferBytesPerDay: 100 * 1024 * 1024,
        maxStorageBytes: 10 * 1024 * 1024, maxTrackedSecurities: 20,
        maxResponseBytes: 10 * 1024 * 1024, minIntervalMs: 10000, timeoutMs: 10000, maxRetries: 0 };
}

export { readConfig as readTaiwanOnDemandConfig };

function automaticRequest(repo: TaiwanRepository) {
    const config = readConfig();
    // A shared quota ledger must be available before starting new upstream work.
    // Cache hits remain usable, but a database outage cannot reset the global allowance.
    const budgetRepo = repo;
    const cachedFetch: typeof fetch = (url, init) => fetch(url, {
        ...init, cache: 'force-cache', next: { revalidate: 3600 },
    } as RequestInit);
    return { request: createBudgetedRequest(budgetRepo, config, cachedFetch), budgetRepo, config };
}

/** Cache failure must not leave an official-data request waiting for MongoDB's long timeout. */
function optionalPersistence(repository: TaiwanRepository): TaiwanRepository {
    const failures = new Map<PropertyKey, { until: number; reason: TaiwanSourceError['reason']; cause: string; code?: number }>();
    return new Proxy(repository, {
        get(target, property) {
            const operation = Reflect.get(target, property);
            if (typeof operation !== 'function') return operation;
            return async (...args: unknown[]) => {
                // A large full-market read and a small filtered query have separate failure scopes.
                const scope = property === 'readCatalog' && args[0] ? 'readCatalog:query' : property;
                const failure = failures.get(scope);
                if (failure && failure.until > Date.now()) {
                    console.warn('[taiwan-data]', { event: 'cache-blocked', operation: String(property),
                        reason: failure.reason, cause: failure.cause, code: failure.code,
                        retryAfterMs: failure.until - Date.now() });
                    throw new TaiwanSourceError(failure.reason, 'Cache operation temporarily unavailable');
                }
                let timer: ReturnType<typeof setTimeout> | undefined;
                let timedOut = false;
                const started = Date.now();
                try {
                    const value = await Promise.race([
                        Reflect.apply(operation, target, args),
                        new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('Cache timeout')); }, 1500); }),
                    ]);
                    failures.delete(scope);
                    return value;
                } catch (error) {
                    const rawCode = (error as { code?: unknown } | null)?.code;
                    const code = typeof rawCode === 'number' ? rawCode : undefined;
                    const reason = error instanceof TaiwanSourceError ? error.reason : 'api-error';
                    const cause = timedOut ? 'cache-timeout' : error instanceof TaiwanSourceError ? error.reason : 'operation-failed';
                    // Cache reads and writes cannot disable a healthy shared quota ledger.
                    // A failed quota operation still blocks new upstream work.
                    failures.set(scope, { until: Date.now() + 60_000, reason, cause, code });
                    // Never print MongoDB messages, connection strings, or environment values.
                    console.warn('[taiwan-data]', { event: 'cache-failure', operation: String(property),
                        reason: cause, code, elapsedMs: Date.now() - started });
                    throw error;
                } finally { if (timer) clearTimeout(timer); }
            };
        },
    });
}

export function getTaiwanOnDemand(repo: TaiwanRepository) {
    let loader = loaders.get(repo);
    if (!loader) {
        loader = createTaiwanOnDemand({ repo });
        loaders.set(repo, loader);
    }
    return loader;
}

export function createTaiwanOnDemand({ repo: repository, request: suppliedRequest, now = () => new Date() }: {
    repo: TaiwanRepository; request?: TaiwanRequester; now?: () => Date;
}) {
    const repo = optionalPersistence(repository);
    let resources: ReturnType<typeof automaticRequest> | undefined;
    const requests = new Map<string, { value: unknown; until: number }>();
    const requestsPending = new Map<string, Promise<unknown>>();
    const request: TaiwanRequester = async (url, init) => {
        const key = `${init?.method ?? 'GET'}:${url}`;
        const cached = requests.get(key);
        if (cached && cached.until > now().getTime()) return cached.value;
        const ongoing = requestsPending.get(key);
        if (ongoing) return ongoing;
        const pending = (async () => {
            const started = Date.now();
            let value: unknown;
            try {
                resources ??= suppliedRequest ? undefined : automaticRequest(repo);
                value = await (suppliedRequest ?? resources!.request)(url, init);
            } catch (error) {
                const endpoint = new URL(url);
                console.warn('[taiwan-data]', { event: 'upstream-failure', host: endpoint.host, path: endpoint.pathname,
                    reason: error instanceof TaiwanSourceError ? error.reason : 'api-error',
                    status: error instanceof TaiwanSourceError ? error.status : undefined, elapsedMs: Date.now() - started });
                throw error;
            }
            requests.set(key, { value, until: now().getTime() + 3600_000 });
            if (requests.size > 8) requests.delete(requests.keys().next().value!);
            return value;
        })();
        requestsPending.set(key, pending);
        try { return await pending; } finally { requestsPending.delete(key); }
    };
    let catalogCache: TaiwanSecurity[] = [];
    let catalogUntil = 0;
    let catalogPending: Promise<TaiwanSecurity[]> | null = null;
    const histories = new Map<string, { value: TaiwanHistory; until: number; depth: number }>();
    const historyPending = new Map<string, Promise<TaiwanHistory>>();
    const detailCache = new Map<string, { value: TaiwanDetails; until: number }>();
    const detailPending = new Map<string, Promise<TaiwanDetails>>();
    const name = (key: TaiwanKey) => `${key.exchange}:${key.code}`;
    async function persist(fn: () => Promise<void>, data?: unknown) {
        try {
            if (data && !suppliedRequest) {
                resources ??= automaticRequest(repo);
                const { config, budgetRepo } = resources;
                const reserved = await budgetRepo.reserveUsage(getTaipeiDayString(now()),
                    { requests: 0, jobs: 0, transferBytes: 0, storageBytes: Buffer.byteLength(JSON.stringify(data)) },
                    { requests: config.maxRequestsPerDay, jobs: config.maxJobsPerDay, transferBytes: config.maxTransferBytesPerDay, storageBytes: config.maxStorageBytes });
                if (!reserved) return;
            }
            await fn();
        } catch { /* Successfully fetched data remains usable without persistence. */ }
    }

    async function catalog(query?: string): Promise<TaiwanSecurity[]> {
        const cached = catalogCache.length && catalogUntil > now().getTime();
        if (cached && (!query || searchTaiwanCatalog(catalogCache, query).length)) return catalogCache;
        // Searching known instruments is a database read, independent of history/upstream budgets.
        // Do not cache this subset as the whole market catalog on a new serverless instance.
        if (query) {
            const stored = await repo.readCatalog(query).catch(() => []);
            const matched = searchTaiwanCatalog(stored, query);
            if (matched.length) return matched;
        }
        if (cached) return catalogCache;
        if (catalogPending) return catalogPending;
        catalogPending = (async () => {
            const stored = await repo.readCatalog().catch(() => []);
            const stamp = await repo.readDatasetCheckpoint('twse-companies').catch(() => null);
            if (!catalogCache.length && stored.length && stamp && Date.parse(stamp) + DAY > now().getTime()) {
                catalogCache = stored;
                catalogUntil = stamp ? Date.parse(stamp) + DAY : now().getTime() + DAY;
                return stored;
            }
            const settled = await Promise.allSettled(CATALOG_IDS.map(id => fetchTaiwanDataset(id, request)));
            const bundle: TaiwanDatasetBundle = {};
            settled.forEach((result, i) => { if (result.status === 'fulfilled') bundle[CATALOG_IDS[i]] = result.value; });
            const loaded = buildTaiwanCatalog(bundle);
            const previous = catalogCache.length ? catalogCache : stored;
            if (!loaded.length) {
                if (previous.length) {
                    catalogCache = previous;
                    catalogUntil = now().getTime() + 60_000;
                    return previous;
                }
                const budgetFailure = settled.find(result => result.status === 'rejected'
                    && result.reason instanceof TaiwanSourceError && result.reason.reason === 'budget-limit');
                if (budgetFailure?.status === 'rejected') throw budgetFailure.reason;
                throw new TaiwanSourceError('api-error', 'Official catalog unavailable');
            }
            // A failed market dataset must not remove existing instruments from the other markets.
            const merged = new Map(previous.map(s => [s.symbol, s]));
            loaded.forEach(s => merged.set(s.symbol, s));
            catalogCache = [...merged.values()];
            const complete = settled.every(s => s.status === 'fulfilled');
            catalogUntil = now().getTime() + (complete ? DAY : 60_000);
            await persist(async () => {
                await repo.writeCatalog(loaded);
                if (complete) await repo.writeDatasetCheckpoint('twse-companies', now().toISOString());
            }, loaded);
            return catalogCache;
        })();
        try { return await catalogPending; } finally { catalogPending = null; }
    }

    async function history(key: TaiwanKey, days: number): Promise<TaiwanHistory> {
        if (!Number.isInteger(days) || days < 1 || days > 1000) throw new TaiwanSourceError('api-error', 'Invalid history range');
        const id = name(key);
        const depth = Math.max(800, days);
        const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', hour: 'numeric', hourCycle: 'h23' }).format(now()));
        const historyDate = new Date(now().getTime() - (hour < 18 ? DAY : 0));
        const anchor = getTaipeiDayString(historyDate);
        const cached = histories.get(id);
        const from = getTaipeiDayString(new Date(now().getTime() - days * DAY));
        const slice = (value: TaiwanHistory): TaiwanHistory => ({ ...value, bars: value.bars.filter(b => b.tradingDate >= from) });
        if (cached && cached.until > now().getTime() && cached.depth >= depth && cached.value.status.asof === anchor) return slice(cached.value);
        if (historyPending.has(id)) return slice(await historyPending.get(id)!);
        const pending = (async (): Promise<TaiwanHistory> => {
            const stored = await repo.readBars(key, getTaipeiDayString(new Date(now().getTime() - 1000 * DAY)), anchor).catch(() => []);
            const known = cached?.value.bars ?? [];
            const bars = new Map([...stored, ...known].map(b => [b.tradingDate, b]));
            const units = planTaiwanHistory(key, depth, historyDate);
            const oldStatus = cached?.value.status ?? await repo.readHistoryStatus(key).catch(() => null);
            const done = new Set(oldStatus?.completedPeriods ?? (oldStatus?.state === 'ready' ? units.map(u => u.period) : []));
            const latest = stored.at(-1);
            const checkedAt = oldStatus?.checkedAt ?? latest?.fetchedAt;
            if (!cached && oldStatus?.state === 'ready' && latest && checkedAt && Date.parse(checkedAt) + 3600_000 > now().getTime()
                && (oldStatus.asof ?? latest.tradingDate) === anchor) {
                const value = { bars: stored.filter(b => b.complete), status: { ...oldStatus, asof: anchor, completedPeriods: [...done] } };
                histories.set(id, { value, until: now().getTime() + 3600_000, depth });
                return value;
            }
            // Period identities survive list shifts at day/month boundaries.
            if (units[0] && (oldStatus?.asof !== anchor || oldStatus?.state === 'ready')) done.delete(units[0].period);
            let reason: TaiwanHistory['status']['reason'] = null;
            const fetched: TaiwanBar[] = [];
            for (const unit of units.filter(u => !done.has(u.period)).slice(0, 2)) {
                try {
                    const rows = await fetchTaiwanHistory(key, unit.period, request);
                    for (const bar of rows) {
                        if (bar.exchange !== key.exchange || bar.code !== key.code) continue;
                        if (bar.tradingDate > anchor) continue;
                        bars.set(bar.tradingDate, bar);
                        fetched.push(bar);
                    }
                    done.add(unit.period);
                } catch (error) {
                    reason = error instanceof TaiwanSourceError && (error.reason === 'budget-limit' || error.reason === 'missing-config') ? error.reason : 'api-error';
                    break;
                }
            }
            const all = [...bars.values()].filter(b => b.complete).sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
            const completedPeriods = units.filter(u => done.has(u.period)).map(u => u.period);
            const completed = completedPeriods.length;
            const value: TaiwanHistory = { bars: all, status: { state: reason ? (all.length ? 'partial' : 'error') : completed >= units.length ? 'ready' : 'partial',
                completed, total: units.length, candleCount: all.length, reason, completedPeriods, asof: anchor, checkedAt: now().toISOString() } };
            // Do not persist a completed period if its bars were not saved.
            await persist(async () => {
                await repo.writeBars(fetched);
                await repo.writeHistoryStatus(key, value.status);
            }, { bars: fetched, status: value.status });
            histories.set(id, { value, until: now().getTime() + (reason ? 60_000 : value.status.state === 'ready' ? 3600_000 : 15_000), depth });
            if (histories.size > (resources?.config.maxTrackedSecurities ?? 20)) histories.delete(histories.keys().next().value!);
            return value;
        })();
        historyPending.set(id, pending);
        try { return slice(await pending); } finally { historyPending.delete(id); }
    }

    async function details(security: TaiwanSecurity): Promise<TaiwanDetails> {
        const id = name(security);
        const cached = detailCache.get(id);
        if (cached && cached.until > now().getTime()) return cached.value;
        if (detailPending.has(id)) return detailPending.get(id)!;
        const pending = (async () => {
            const stored = await repo.readDetails(security).catch(() => null);
            if (stored?.asof && Date.parse(stored.asof) + DAY > now().getTime()) return stored;
            const bundle: TaiwanDatasetBundle = {};
            if (security.kind === 'stock') {
                const ids: TaiwanDatasetId[] = security.exchange === 'TWSE'
                    ? ['twse-bwibbu-all', 'twse-revenue', 'twse-eps', 'twse-announcements']
                    : ['tpex-peratio-analysis', 'tpex-revenue', 'tpex-eps', 'tpex-announcements'];
                await Promise.all(ids.map(async dataset => {
                    try { bundle[dataset] = await fetchTaiwanDataset(dataset, request); } catch { /* Partial information is allowed. */ }
                }));
            }
            const fresh = buildTaiwanDetails(security, bundle);
            const value = fresh.fields.some(f => f.value !== null) || !stored ? fresh : stored;
            detailCache.set(id, { value, until: now().getTime() + DAY });
            if (detailCache.size > (resources?.config.maxTrackedSecurities ?? 20)) detailCache.delete(detailCache.keys().next().value!);
            await persist(() => repo.writeDetails(value), value);
            return value;
        })();
        detailPending.set(id, pending);
        try { return await pending; } finally { detailPending.delete(id); }
    }
    return { catalog, history, details };
}
