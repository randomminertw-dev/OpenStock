import { getTaipeiDayString } from './budget';
import { buildTaiwanCatalog } from './catalog';
import { parseTaiwanDate, parseTaiwanNumber, taiwanDateToTimestamp } from './parsers';
import { fetchTaiwanDataset } from './sources';
import {
    type SyncSummary,
    type TaiwanBar,
    type TaiwanDatasetId,
    type TaiwanRepository,
    type TaiwanRequester,
} from './types';

const FUNDAMENTAL_DATASETS: TaiwanDatasetId[] = [
    'twse-revenue',
    'tpex-revenue',
    'twse-eps',
    'tpex-eps',
    'twse-bwibbu-all',
    'tpex-peratio-analysis',
    'twse-exright',
    'tpex-exright',
    'twse-announcements',
    'tpex-announcements',
    'twse-financials-ci',
    'tpex-financials-ci',
    'twse-balance-ci',
    'tpex-balance-ci',
];

/**
 * Parses TWSE holiday schedule into a Set of YYYY-MM-DD holiday dates.
 */
export function parseTaiwanHolidays(raw: unknown): Set<string> {
    const holidays = new Set<string>();
    if (Array.isArray(raw)) {
        for (const item of raw) {
            if (!item || typeof item !== 'object') continue;
            const rawDate =
                (item as Record<string, unknown>).Date ??
                (item as Record<string, unknown>).date;
            const parsed = parseTaiwanDate(rawDate);
            if (parsed) holidays.add(parsed);
        }
    }
    return holidays;
}

/**
 * Determines whether a date is a valid Taiwan trading day.
 * Skips weekends (Saturday & Sunday) and official holidays.
 */
export function isTaiwanTradingDay(date: string | Date, holidays?: Set<string>): boolean {
    const dateStr = typeof date === 'string' ? date : getTaipeiDayString(date);
    const [y, m, d] = dateStr.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    // Weekends (0: Sunday, 6: Saturday)
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;
    // Known official holidays
    if (holidays && holidays.has(dateStr)) return false;
    return true;
}

/**
 * Synchronizes Taiwan post-market close data:
 * - Uses repo.claimJob / releaseJob to enforce job leasing (close:sync:YYYY-MM-DD).
 * - Checks dataset checkpoints to prevent duplicate daily full fetches.
 * - Saves raw OpenAPI close bars with complete: false (unconfirmed snapshot).
 * - Preserves actual trading date when upstream date is older than today.
 * - Catches upstream errors per dataset without blocking other datasets.
 */
export async function syncTaiwanClose(input: {
    repo: TaiwanRepository;
    request: TaiwanRequester;
    now?: Date;
}): Promise<SyncSummary> {
    const { repo, request, now = new Date() } = input;
    const todayStr = getTaipeiDayString(now);

    const summary: SyncSummary = {
        requested: 0,
        written: 0,
        skipped: 0,
        failures: [],
    };

    const jobKey = `close:sync:${todayStr}`;
    const workerId = `close-worker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const acquired = await repo.claimJob(jobKey, workerId, 5 * 60 * 1000);
    if (!acquired) {
        summary.failures.push(`Job lease active: ${jobKey} is already locked by another worker`);
        return summary;
    }

    try {
        // 1. Catalog Master Datasets Checkpoint
        try {
            const catalogCheckpoint = await repo.readDatasetCheckpoint('twse-companies');
            if (catalogCheckpoint === todayStr) {
                summary.skipped += 4;
            } else {
                const [twseCompanies, twseEtfs, tpexCompanies, tpexEtfs] = await Promise.all([
                    fetchTaiwanDataset('twse-companies', request).catch(err => {
                        summary.failures.push(`twse-companies: ${err.message || err}`);
                        return [];
                    }),
                    fetchTaiwanDataset('twse-etfs', request).catch(err => {
                        summary.failures.push(`twse-etfs: ${err.message || err}`);
                        return [];
                    }),
                    fetchTaiwanDataset('tpex-companies', request).catch(err => {
                        summary.failures.push(`tpex-companies: ${err.message || err}`);
                        return [];
                    }),
                    fetchTaiwanDataset('tpex-etfs', request).catch(err => {
                        summary.failures.push(`tpex-etfs: ${err.message || err}`);
                        return [];
                    }),
                ]);
                summary.requested += 4;

                const catalog = buildTaiwanCatalog({
                    'twse-companies': twseCompanies,
                    'twse-etfs': twseEtfs,
                    'tpex-companies': tpexCompanies,
                    'tpex-etfs': tpexEtfs,
                });

                if (catalog.length > 0) {
                    await repo.writeCatalog(catalog);
                    await repo.writeDatasetCheckpoint('twse-companies', todayStr);
                    summary.written += catalog.length;
                }
            }
        } catch (err) {
            summary.failures.push(`Catalog sync error: ${err instanceof Error ? err.message : String(err)}`);
        }

        // 2. Holiday Schedule Check (Conservative freshness)
        let _holidays = new Set<string>();
        try {
            const rawHolidays = await fetchTaiwanDataset('twse-holiday', request);
            summary.requested++;
            _holidays = parseTaiwanHolidays(rawHolidays);
            void _holidays;
        } catch (err) {
            summary.failures.push(`Holiday schedule error: ${err instanceof Error ? err.message : String(err)}`);
        }

    // 3. TWSE OpenAPI Close Quotes (complete: false snapshot)
    try {
        const rawTwse = (await fetchTaiwanDataset('twse-stock-day-all', request)) as Record<string, unknown>[];
        summary.requested++;

        if (Array.isArray(rawTwse) && rawTwse.length > 0) {
            const twseBars: TaiwanBar[] = [];
            const fetchedAt = now.toISOString();

            for (const row of rawTwse) {
                if (!row || typeof row !== 'object') continue;
                const code = String(row.Code ?? row.code ?? '').trim();
                if (!/^[0-9][A-Z0-9]{3,7}$/.test(code)) continue;

                const rawDate = row.Date ?? row.date;
                const tradingDate = (rawDate ? parseTaiwanDate(rawDate) : null) ?? todayStr;

                const o = parseTaiwanNumber(row.OpeningPrice ?? row.open);
                const h = parseTaiwanNumber(row.HighestPrice ?? row.high);
                const l = parseTaiwanNumber(row.LowestPrice ?? row.low);
                const c = parseTaiwanNumber(row.ClosingPrice ?? row.close);
                const v = parseTaiwanNumber(row.TradeVolume ?? row.volume);
                const change = parseTaiwanNumber(row.Change ?? row.change);

                if (o === null || h === null || l === null || c === null || v === null) continue;
                if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || v < 0) continue;

                twseBars.push({
                    exchange: 'TWSE',
                    code,
                    tradingDate,
                    t: taiwanDateToTimestamp(tradingDate),
                    o,
                    h,
                    l,
                    c,
                    v,
                    change,
                    complete: false, // OpenAPI snapshot is not official completed bar!
                    source: 'twse',
                    priceBasis: 'unadjusted',
                    fetchedAt,
                });
            }

            if (twseBars.length > 0) {
                await repo.writeBars(twseBars);
                summary.written += twseBars.length;
            }
        }
    } catch (err) {
        summary.failures.push(`TWSE close quotes error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. TPEX OpenAPI Close Quotes (complete: false snapshot)
    try {
        const rawTpex = (await fetchTaiwanDataset('tpex-mainboard-daily-close-quotes', request)) as Record<string, unknown>[];
        summary.requested++;

        if (Array.isArray(rawTpex) && rawTpex.length > 0) {
            const tpexBars: TaiwanBar[] = [];
            const fetchedAt = now.toISOString();

            for (const row of rawTpex) {
                if (!row || typeof row !== 'object') continue;
                const code = String(row.SecuritiesCompanyCode ?? row.code ?? '').trim();
                if (!/^[0-9][A-Z0-9]{3,7}$/.test(code)) continue;

                const rawDate = row.Date ?? row.date;
                const tradingDate = (rawDate ? parseTaiwanDate(rawDate) : null) ?? todayStr;

                const o = parseTaiwanNumber(row.Open ?? row.open);
                const h = parseTaiwanNumber(row.High ?? row.high);
                const l = parseTaiwanNumber(row.Low ?? row.low);
                const c = parseTaiwanNumber(row.Close ?? row.close);
                const v = parseTaiwanNumber(row.TradingShares ?? row.volume);
                const change = parseTaiwanNumber(row.Change ?? row.change);

                if (o === null || h === null || l === null || c === null || v === null) continue;
                if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || v < 0) continue;

                tpexBars.push({
                    exchange: 'TPEX',
                    code,
                    tradingDate,
                    t: taiwanDateToTimestamp(tradingDate),
                    o,
                    h,
                    l,
                    c,
                    v,
                    change,
                    complete: false, // OpenAPI snapshot is not official completed bar!
                    source: 'tpex',
                    priceBasis: 'unadjusted',
                    fetchedAt,
                });
            }

            if (tpexBars.length > 0) {
                await repo.writeBars(tpexBars);
                summary.written += tpexBars.length;
            }
        }
    } catch (err) {
        summary.failures.push(`TPEX close quotes error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 5. Fundamentals & Announcements Datasets
    for (const datasetId of FUNDAMENTAL_DATASETS) {
        try {
            const cp = await repo.readDatasetCheckpoint(datasetId);
            if (cp === todayStr) {
                summary.skipped++;
                continue;
            }

            await fetchTaiwanDataset(datasetId, request);
            summary.requested++;
            await repo.writeDatasetCheckpoint(datasetId, todayStr);
        } catch (err) {
            summary.failures.push(`${datasetId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return summary;
    } finally {
        await repo.releaseJob(jobKey, workerId);
    }
}
