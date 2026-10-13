'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import {
    getTaiwanSecurity as readSecurity,
    getTaiwanQuote as readQuote,
    searchTaiwanSecurities as readSearch,
    getTaiwanHistory as readHistory,
    getTaiwanDetails as readDetails,
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

/**
 * Triggers Taiwan history synchronization. Requires signed-in session.
 */
export async function triggerTaiwanHistorySync(
    symbol: string,
    days = 800
): Promise<TaiwanHistoryStatus> {
    await requireUserId();
    const sec = await readSecurity(symbol);
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
    return await requestTaiwanHistory(key, days);
}
