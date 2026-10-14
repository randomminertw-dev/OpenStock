export type TaiwanExchange = 'TWSE' | 'TPEX';

export type TaiwanKey = {
    exchange: TaiwanExchange;
    code: string;
};

export type TaiwanSecurity = TaiwanKey & {
    symbol: string;
    name: string;
    kind: 'stock' | 'etf' | 'unknown';
    currency: string | null;
    listingDate: string | null;
    status: 'active' | 'suspended' | 'delisted' | 'unknown';
    metadata: Record<string, string>;
    source: string;
    asof: string;
};

export type TaiwanBar = TaiwanKey & {
    tradingDate: string;
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    change: number | null;
    complete: boolean;
    source: 'twse' | 'tpex';
    priceBasis: 'unadjusted';
    fetchedAt: string;
};

export type TaiwanQuote = TaiwanKey & {
    price: number | null;
    change: number | null;
    changePercent: number | null;
    currency: string | null;
    tradingDate: string | null;
    source: 'twse' | 'tpex';
    mode: 'close';
    stale: boolean;
};

export type TaiwanHistoryStatus = {
    completedPeriods?: string[];
    asof?: string;
    checkedAt?: string;
    state: 'disabled' | 'queued' | 'running' | 'partial' | 'ready' | 'error';
    completed: number;
    total: number;
    candleCount: number;
    reason: 'api-error' | 'budget-limit' | 'missing-config' | null;
};

export type TaiwanHistory = {
    bars: TaiwanBar[];
    status: TaiwanHistoryStatus;
};

export type HistoryUnit = {
    exchange: TaiwanExchange;
    period: string;
    keys: TaiwanKey[];
};

export type SyncSummary = {
    requested: number;
    written: number;
    skipped: number;
    failures: string[];
};

export type TaiwanEvent = {
    date: string;
    kind: 'dividend' | 'split' | 'capital-change';
    title: string;
    source: string;
};

export type TaiwanDetails = {
    security: TaiwanSecurity;
    fields: { label: string; value: string | null; period: string | null; unit: string | null }[];
    announcements: { date: string; title: string; body: string; sourceUrl: string }[];
    events: TaiwanEvent[];
    asof: string | null;
};

export type TaiwanRequester = (url: string, init?: RequestInit) => Promise<unknown>;

export type { TaiwanCatalogInput, TaiwanDatasetBundle, TaiwanDatasetId } from './datasets';
import type { TaiwanDatasetId } from './datasets';

export class TaiwanSourceError extends Error {
    constructor(
        public readonly reason: 'api-error' | 'budget-limit' | 'missing-config' | 'no-data',
        message?: string,
        public readonly status?: number
    ) {
        super(message || reason);
        this.name = 'TaiwanSourceError';
    }
}

export type TaiwanUsageAmounts = {
    requests: number;
    jobs: number;
    transferBytes: number;
    storageBytes: number;
};

export type TaiwanUsageLimits = {
    requests: number;
    jobs: number;
    transferBytes: number;
    storageBytes: number;
};

export type TaiwanSyncConfig = {
    autoSyncEnabled: boolean;
    historyEnabled: boolean;
    maxRequestsPerDay: number;
    maxJobsPerDay: number;
    maxTransferBytesPerDay: number;
    maxStorageBytes: number;
    maxTrackedSecurities: number;
    maxResponseBytes: number;
    upstreamConcurrency?: number;
    minIntervalMs?: number;
    timeoutMs?: number;
    maxRetries?: number;
};

export interface TaiwanRepository {
    /** A query returns matching persisted instruments without downloading the full catalog. */
    readCatalog(query?: string): Promise<TaiwanSecurity[]>;
    readBars(key: TaiwanKey, from?: string, through?: string): Promise<TaiwanBar[]>;
    readDetails(key: TaiwanKey): Promise<TaiwanDetails | null>;
    writeCatalog(items: TaiwanSecurity[]): Promise<void>;
    writeBars(bars: TaiwanBar[]): Promise<void>;
    writeDetails(details: TaiwanDetails): Promise<void>;
    claimJob(jobKey: string, owner: string, ttlMs: number): Promise<boolean>;
    releaseJob(jobKey: string, owner: string): Promise<void>;
    readHistoryStatus(key: TaiwanKey): Promise<TaiwanHistoryStatus>;
    writeHistoryStatus(key: TaiwanKey, status: TaiwanHistoryStatus): Promise<void>;
    readDatasetCheckpoint(id: TaiwanDatasetId): Promise<string | null>;
    writeDatasetCheckpoint(id: TaiwanDatasetId, asof: string): Promise<void>;
    reserveUsage(day: string, amounts: TaiwanUsageAmounts, limits: TaiwanUsageLimits): Promise<boolean>;
    settleUsage(day: string, amounts: TaiwanUsageAmounts): Promise<void>;
}
