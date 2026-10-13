import { parseTaiwanKey, taiwanAliases } from './symbols';
import { searchTaiwanCatalog } from './catalog';
import { createMongoTaiwanRepository } from './repository';
import {
    type TaiwanDetails,
    type TaiwanHistory,
    type TaiwanKey,
    type TaiwanQuote,
    type TaiwanRepository,
    type TaiwanSecurity,
} from './types';

let testRepository: TaiwanRepository | null = null;

/**
 * Injects a TaiwanRepository for unit tests and local mocking.
 */
export function setTaiwanRepositoryForTesting(repo: TaiwanRepository | null): void {
    testRepository = repo;
}

function getRepo(injected?: TaiwanRepository): TaiwanRepository {
    return injected ?? testRepository ?? createMongoTaiwanRepository();
}

/**
 * Resolves a Taiwan security from canonical key or aliases (e.g. TWSE:2330, 2330.TW, 2330).
 */
export async function getTaiwanSecurity(
    symbol: string,
    injectedRepo?: TaiwanRepository
): Promise<TaiwanSecurity | null> {
    if (!symbol || typeof symbol !== 'string') return null;
    const trimmed = symbol.trim();
    if (!trimmed) return null;

    const repo = getRepo(injectedRepo);
    let catalog: TaiwanSecurity[] = [];
    try {
        catalog = await repo.readCatalog();
    } catch {
        return null;
    }

    const explicitKey = parseTaiwanKey(trimmed);
    if (explicitKey) {
        return (
            catalog.find(
                (s) => s.exchange === explicitKey.exchange && s.code === explicitKey.code
            ) ?? null
        );
    }

    const upper = trimmed.toUpperCase();
    return (
        catalog.find(
            (s) =>
                s.code === upper ||
                s.symbol.toUpperCase() === upper ||
                taiwanAliases(s).map((a) => a.toUpperCase()).includes(upper)
        ) ?? null
    );
}

/**
 * Reads official closing quote for a Taiwan security.
 */
export async function getTaiwanQuote(
    symbol: string,
    injectedRepo?: TaiwanRepository
): Promise<TaiwanQuote | null> {
    if (!symbol || typeof symbol !== 'string') return null;
    const trimmed = symbol.trim();
    if (!trimmed) return null;

    const repo = getRepo(injectedRepo);
    let sec: TaiwanSecurity | null = null;
    try {
        sec = await getTaiwanSecurity(trimmed, repo);
    } catch {
        // Fall through to parse key directly
    }

    const key: TaiwanKey | null =
        parseTaiwanKey(trimmed) ?? (sec ? { exchange: sec.exchange, code: sec.code } : null);
    if (!key) return null;

    let bars = [];
    try {
        bars = await repo.readBars(key);
    } catch {
        return null;
    }

    const defaultSource = key.exchange === 'TWSE' ? 'twse' : 'tpex';

    if (bars.length === 0) {
        return {
            exchange: key.exchange,
            code: key.code,
            price: null,
            change: null,
            changePercent: null,
            currency: sec?.currency ?? null,
            tradingDate: null,
            source: defaultSource,
            mode: 'close',
            stale: false,
        };
    }

    const latest = bars[bars.length - 1];
    const prev = bars.length > 1 ? bars[bars.length - 2] : null;

    const price = latest.c;
    let change: number | null = latest.change ?? null;
    if (change === null && prev && prev.c !== undefined && prev.c !== null) {
        change = latest.c - prev.c;
    }

    let changePercent: number | null = null;
    if (change !== null) {
        if (change === 0) {
            changePercent = 0;
        } else if (prev && prev.c > 0) {
            changePercent = Number(((change / prev.c) * 100).toFixed(2));
        } else if (latest.c - change > 0) {
            changePercent = Number(((change / (latest.c - change)) * 100).toFixed(2));
        }
    }

    return {
        exchange: key.exchange,
        code: key.code,
        price,
        change,
        changePercent,
        currency: sec?.currency ?? null,
        tradingDate: latest.tradingDate,
        source: latest.source,
        mode: 'close',
        stale: !latest.complete,
    };
}

/**
 * Searches Taiwan securities catalog by code, name, or full exchange symbol.
 */
export async function searchTaiwanSecurities(
    query: string,
    injectedRepo?: TaiwanRepository
): Promise<StockWithWatchlistStatus[]> {
    if (!query || typeof query !== 'string') return [];
    const trimmed = query.trim();
    if (!trimmed) return [];

    const repo = getRepo(injectedRepo);
    let catalog: TaiwanSecurity[] = [];
    try {
        catalog = await repo.readCatalog();
    } catch {
        throw new Error('台股資料庫準備中或同步未啟用');
    }

    if (catalog.length === 0) {
        throw new Error('台股資料庫準備中或同步未啟用');
    }

    const matched = searchTaiwanCatalog(catalog, trimmed, 15);
    return matched.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        exchange: item.exchange,
        type: item.kind === 'etf' ? 'ETF' : 'Stock',
        isInWatchlist: false,
    }));
}

/**
 * Reads Taiwan history bars and background sync status.
 */
export async function getTaiwanHistory(
    symbol: string,
    days = 120,
    injectedRepo?: TaiwanRepository
): Promise<TaiwanHistory> {
    const fallbackStatus = {
        state: 'disabled' as const,
        completed: 0,
        total: 0,
        candleCount: 0,
        reason: null,
    };

    if (!symbol || typeof symbol !== 'string') {
        return { bars: [], status: fallbackStatus };
    }

    const repo = getRepo(injectedRepo);
    let sec: TaiwanSecurity | null = null;
    try {
        sec = await getTaiwanSecurity(symbol, repo);
    } catch {
        // continue
    }

    const key: TaiwanKey | null =
        parseTaiwanKey(symbol) ?? (sec ? { exchange: sec.exchange, code: sec.code } : null);
    if (!key) {
        return { bars: [], status: fallbackStatus };
    }

    try {
        const allBars = await repo.readBars(key);
        const bars = days > 0 ? allBars.slice(-days) : allBars;
        const status = await repo.readHistoryStatus(key);
        return { bars, status };
    } catch {
        return {
            bars: [],
            status: {
                state: 'error',
                completed: 0,
                total: 0,
                candleCount: 0,
                reason: 'api-error',
            },
        };
    }
}

/**
 * Reads Taiwan fundamental details.
 */
export async function getTaiwanDetails(
    symbol: string,
    injectedRepo?: TaiwanRepository
): Promise<TaiwanDetails | null> {
    if (!symbol || typeof symbol !== 'string') return null;

    const repo = getRepo(injectedRepo);
    let sec: TaiwanSecurity | null = null;
    try {
        sec = await getTaiwanSecurity(symbol, repo);
    } catch {
        // continue
    }

    const key: TaiwanKey | null =
        parseTaiwanKey(symbol) ?? (sec ? { exchange: sec.exchange, code: sec.code } : null);
    if (!key) return null;

    try {
        const stored = await repo.readDetails(key);
        if (stored) return stored;
        if (sec) {
            return {
                security: sec,
                fields: [],
                announcements: [],
                events: [],
                asof: sec.asof,
            };
        }
        return null;
    } catch {
        return sec
            ? {
                  security: sec,
                  fields: [],
                  announcements: [],
                  events: [],
                  asof: sec.asof,
              }
            : null;
    }
}
