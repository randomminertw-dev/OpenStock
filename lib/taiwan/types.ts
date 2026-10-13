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

export type { TaiwanDatasetBundle, TaiwanDatasetId } from './datasets';

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
