'use server';

import {
    getTaiwanSecurity as readSecurity,
    getTaiwanQuote as readQuote,
    searchTaiwanSecurities as readSearch,
    getTaiwanHistory as readHistory,
    getTaiwanDetails as readDetails,
    getTaiwanRepository,
} from '@/lib/taiwan/reads';
import { parseTaiwanKey } from '@/lib/taiwan/symbols';
import { requestTaiwanHistory } from '@/lib/taiwan/history';
import type {
    TaiwanDetails,
    TaiwanHistory,
    TaiwanHistoryStatus,
    TaiwanQuote,
    TaiwanSecurity,
} from '@/lib/taiwan/types';

export async function getTaiwanSecurity(symbol: string): Promise<TaiwanSecurity | null> {
    return await readSecurity(symbol);
}

export async function getTaiwanQuote(symbol: string): Promise<TaiwanQuote | null> {
    return await readQuote(symbol);
}

export async function searchTaiwanSecurities(query: string): Promise<StockWithWatchlistStatus[]> {
    return await readSearch(query);
}

export async function getTaiwanHistory(symbol: string, days = 120): Promise<TaiwanHistory> {
    return await readHistory(symbol, days);
}

export async function getTaiwanDetails(symbol: string): Promise<TaiwanDetails | null> {
    return await readDetails(symbol);
}

export async function getTaiwanPageData(symbol: string): Promise<{
    security: TaiwanSecurity | null;
    quote: TaiwanQuote | null;
    history: TaiwanHistory;
    details: TaiwanDetails | null;
    isInWatchlist: boolean;
}> {
    const repo = getTaiwanRepository();
    let session = null;
    try {
        const { getSession } = await import('@/lib/better-auth/auth');
        session = await getSession();
    } catch {
        session = null;
    }

    let isInWatchlist = false;
    if (session?.user) {
        try {
            const { isStockInWatchlist } = await import('@/lib/actions/watchlist.actions');
            isInWatchlist = await isStockInWatchlist(symbol);
        } catch {
            isInWatchlist = false;
        }
    }

    const [security, quote, history, details] = await Promise.all([
        readSecurity(symbol, repo),
        readQuote(symbol, repo),
        readHistory(symbol, 800, repo),
        readDetails(symbol, repo),
    ]);

    if (session?.user) {
        const currentStatus = history.status;
        if (
            currentStatus.state !== 'ready' &&
            currentStatus.state !== 'running' &&
            currentStatus.state !== 'queued'
        ) {
            const key =
                parseTaiwanKey(symbol) ??
                (security ? { exchange: security.exchange, code: security.code } : null);
            if (key && process.env.TAIWAN_HISTORY_ENABLED === 'true') {
                try {
                    const nextStatus = await requestTaiwanHistory(key, 800, repo);
                    if (nextStatus.state === 'queued' || nextStatus.state === 'running') {
                        history.status = nextStatus;
                    }
                } catch (err) {
                    console.error('Failed to trigger background Taiwan history sync:', err);
                }
            }
        }
    }

    return { security, quote, history, details, isInWatchlist };
}

/**
 * Triggers Taiwan history synchronization. Requires signed-in session.
 */
export async function requestTaiwanHistoryAction(
    symbol: string,
    days = 800
): Promise<TaiwanHistoryStatus> {
    const { requireUserId } = await import('@/lib/better-auth/auth');
    await requireUserId();
    const repo = getTaiwanRepository();
    const sec = await readSecurity(symbol, repo);
    const key = parseTaiwanKey(symbol) ?? (sec ? { exchange: sec.exchange, code: sec.code } : null);
    if (!key) {
        return {
            state: 'disabled',
            completed: 0,
            total: 0,
            candleCount: 0,
            reason: null,
        };
    }
    return await requestTaiwanHistory(key, days, repo);
}

/**
 * Backwards compatible alias for requestTaiwanHistoryAction.
 */
export const triggerTaiwanHistorySync = requestTaiwanHistoryAction;
