import type { CandleFailureReason, CandleResult, CandleSource, RawCandles } from './types';

export class CandleRequestError extends Error {
    constructor(public reason: CandleFailureReason) {
        super(reason);
    }
}

export function failure(reason: CandleFailureReason, source: CandleSource | null = null): CandleResult {
    return { candles: null, reason, source };
}

/** Cache results and share pending requests; failures recover after one minute. */
export function createCandleCache() {
    const results = new Map<string, { value: CandleResult; until: number }>();
    const pending = new Map<string, Promise<CandleResult>>();
    return {
        clear() { results.clear(); pending.clear(); },
        async get(key: string, source: CandleSource, load: () => Promise<RawCandles>): Promise<CandleResult> {
            const hit = results.get(key);
            if (hit && hit.until > Date.now()) return hit.value;
            const underway = pending.get(key);
            if (underway) return underway;
            const request = (async () => {
                let value: CandleResult;
                try {
                    value = { candles: await load(), reason: null, source };
                } catch (error) {
                    value = failure(error instanceof CandleRequestError ? error.reason : 'api-error', source);
                    // Do not log request headers, keys, tokens, or provider response bodies.
                    console.error('[candles]', source.provider, source.symbol, value.reason);
                }
                if (results.size >= 500) results.delete(results.keys().next().value!);
                results.set(key, { value, until: Date.now() + (value.candles ? 3600_000 : 60_000) });
                return value;
            })();
            pending.set(key, request);
            try { return await request; } finally { pending.delete(key); }
        },
    };
}

export async function fetchCandleJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!response.ok) {
        if ((response.status === 401 || response.status === 403) && Object.keys(headers).length > 0) {
            throw new CandleRequestError('missing-config');
        }
        if (response.status === 404) throw new CandleRequestError('unsupported-symbol');
        // Binance uses -1121 specifically for invalid symbols. Other 400s are request failures.
        if (response.status === 400) {
            const error = await response.json().catch(() => null);
            if (error?.code === -1121) throw new CandleRequestError('unsupported-symbol');
        }
        throw new CandleRequestError('api-error');
    }
    return response.json();
}

type Row = { t: unknown; o: unknown; h: unknown; l: unknown; c: unknown; v: unknown };
const numeric = (v: unknown): number =>
    typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;

/** Invalid price rows are dropped as a unit; missing volume remains non-voting. */
export function normalizeCandles(rows: Row[]): RawCandles {
    if (rows.length === 0) throw new CandleRequestError('no-data');
    const valid = new Map<number, { t: number; o: number; h: number; l: number; c: number; v: number; volumeComplete: boolean }>();
    for (const row of rows) {
        const t = numeric(row.t);
        const [o, h, l, c] = [row.o, row.h, row.l, row.c].map(numeric);
        if (![t, o, h, l, c].every(Number.isFinite) || t <= 0 || Math.min(o, h, l, c) <= 0) continue;
        const v = numeric(row.v);
        if (Number.isFinite(v) && v < 0) continue;
        valid.set(t, { t, o, h, l, c, v: Number.isFinite(v) ? v : 0, volumeComplete: Number.isFinite(v) });
    }
    if (valid.size === 0) throw new CandleRequestError('api-error');
    const sorted = [...valid.values()].sort((a, b) => a.t - b.t);
    return {
        s: 'ok', t: sorted.map(r => r.t), o: sorted.map(r => r.o),
        h: sorted.map(r => r.h), l: sorted.map(r => r.l),
        c: sorted.map(r => r.c), v: sorted.map(r => r.v),
        ...(sorted.some(r => !r.volumeComplete) ? { volumeComplete: false } : {}),
    };
}
