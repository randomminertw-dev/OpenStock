import { getTaipeiDayString } from './budget';
import { loadTaiwanSyncConfig } from './config';
import { createMongoTaiwanRepository } from './repository';
import { fetchTaiwanHistory } from './sources';
import {
    TaiwanSourceError,
    type HistoryUnit,
    type SyncSummary,
    type TaiwanBar,
    type TaiwanHistoryStatus,
    type TaiwanKey,
    type TaiwanRepository,
    type TaiwanRequester,
} from './types';

/**
 * Computes the date string of the cutoff for the most recent N effective trading days (skipping weekends).
 */
export function getRecentTradingCutoff(now: Date, count = 5): string {
    let daysFound = 0;
    let offset = 0;
    let cutoff = getTaipeiDayString(now);
    while (daysFound < count && offset < 30) {
        const d = new Date(now.getTime() - offset * 86400000);
        const dateStr = getTaipeiDayString(d);
        const [y, m, day] = dateStr.split('-').map(Number);
        const dayOfWeek = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            daysFound++;
            cutoff = dateStr;
        }
        offset++;
    }
    return cutoff;
}

/**
 * Plans history fetching units ordered from newest (closest) to oldest.
 * - For TWSE: plans deduped monthly periods (YYYY-MM).
 * - For TPEX: plans daily periods (YYYY-MM-DD), skipping weekends.
 * Days range is clamped to 1-1000, default 800.
 */
export function planTaiwanHistory(
    key: TaiwanKey,
    days?: number,
    now: Date = new Date()
): HistoryUnit[] {
    const rawDays = days ?? 800;
    const targetDays = rawDays > 0 ? Math.min(1000, Math.floor(rawDays)) : 800;
    const units: HistoryUnit[] = [];

    if (key.exchange === 'TWSE') {
        const seenMonths = new Set<string>();
        for (let i = 0; i < targetDays; i++) {
            const d = new Date(now.getTime() - i * 86400000);
            const dateStr = getTaipeiDayString(d);
            const monthStr = dateStr.slice(0, 7);
            if (!seenMonths.has(monthStr)) {
                seenMonths.add(monthStr);
                units.push({
                    exchange: 'TWSE',
                    period: monthStr,
                    keys: [key],
                });
            }
        }
    } else if (key.exchange === 'TPEX') {
        for (let i = 0; i < targetDays; i++) {
            const d = new Date(now.getTime() - i * 86400000);
            const dateStr = getTaipeiDayString(d);
            const [y, m, day] = dateStr.split('-').map(Number);
            const dayOfWeek = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
            // Skip weekends (0: Sunday, 6: Saturday)
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                units.push({
                    exchange: 'TPEX',
                    period: dateStr,
                    keys: [key],
                });
            }
        }
    }

    return units;
}

/**
 * Synchronizes history for the given keys.
 * - Uses repo.claimJob / releaseJob to enforce job leasing per symbol/batch.
 * - Skips older historical periods that already have confirmed (complete: true) bars in repo.
 * - Keeps the most recent 5 effective trading days / current month eligible for re-fetch/correction.
 * - Enforces TPEX batch sharing (1 request per date covers all tracked TPEX keys).
 * - Preserves successfully written bars upon upstream errors.
 */
export async function syncTaiwanHistory(input: {
    repo: TaiwanRepository;
    request: TaiwanRequester;
    keys: TaiwanKey[];
    days?: number;
    now?: Date;
}): Promise<SyncSummary> {
    const { repo, request, keys, days = 800, now = new Date() } = input;
    const summary: SyncSummary = {
        requested: 0,
        written: 0,
        skipped: 0,
        failures: [],
    };

    if (!keys || keys.length === 0) {
        return summary;
    }

    const currentMonth = getTaipeiDayString(now).slice(0, 7);
    const cutoffDate = getRecentTradingCutoff(now, 5);
    const cutoffMonth = cutoffDate.slice(0, 7);

    const twseKeys = keys.filter(k => k.exchange === 'TWSE');
    const tpexKeys = keys.filter(k => k.exchange === 'TPEX');

    // 1. Process TWSE keys (per-symbol monthly requests with job leasing)
    for (const twseKey of twseKeys) {
        const jobKey = `history:${twseKey.exchange}:${twseKey.code}`;
        const workerId = `history-worker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const acquired = await repo.claimJob(jobKey, workerId, 5 * 60 * 1000);
        if (!acquired) {
            summary.skipped++;
            continue;
        }

        try {
            const units = planTaiwanHistory(twseKey, days, now);
            let successfulUnits = 0;
            let keyFailure: string | null = null;
            let existingBars = await repo.readBars(twseKey);

            await repo.writeHistoryStatus(twseKey, {
                state: 'running',
                completed: 0,
                total: units.length,
                candleCount: existingBars.length,
                reason: null,
            });

            for (const unit of units) {
                // Keep recent 5 trading days / current month eligible for re-fetch
                const isEligible = unit.period === currentMonth || unit.period >= cutoffMonth;
                if (!isEligible) {
                    const hasCompleted = existingBars.some(
                        b => b.tradingDate.startsWith(unit.period) && b.complete
                    );
                    if (hasCompleted) {
                        summary.skipped++;
                        successfulUnits++;
                        continue;
                    }
                }

                try {
                    const bars = await fetchTaiwanHistory(twseKey, unit.period, request);
                    summary.requested++;
                    if (bars && bars.length > 0) {
                        await repo.writeBars(bars);
                        summary.written += bars.length;
                        existingBars = [...existingBars, ...bars];
                    }
                    successfulUnits++;
                } catch (err) {
                    if (err instanceof TaiwanSourceError && err.reason === 'budget-limit') {
                        summary.failures.push('budget-limit');
                        await repo.writeHistoryStatus(twseKey, {
                            state: 'partial',
                            completed: successfulUnits,
                            total: units.length,
                            candleCount: existingBars.length,
                            reason: 'budget-limit',
                        });
                        return summary;
                    }
                    const msg = err instanceof Error ? err.message : String(err);
                    summary.failures.push(msg);
                    keyFailure = msg;
                    break; // Stop further units for this key on error, preserving existing data
                }
            }

            if (keyFailure) {
                await repo.writeHistoryStatus(twseKey, {
                    state: existingBars.length > 0 ? 'partial' : 'error',
                    completed: successfulUnits,
                    total: units.length,
                    candleCount: existingBars.length,
                    reason: 'api-error',
                });
            } else {
                await repo.writeHistoryStatus(twseKey, {
                    state: successfulUnits >= units.length ? 'ready' : 'partial',
                    completed: successfulUnits,
                    total: units.length,
                    candleCount: existingBars.length,
                    reason: null,
                });
            }
        } finally {
            await repo.releaseJob(jobKey, workerId);
        }
    }

    // 2. Process TPEX keys (shared daily requests with job leasing)
    if (tpexKeys.length > 0) {
        const tpexWorkerId = `history-tpex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const claimedTpexKeys: TaiwanKey[] = [];
        for (const k of tpexKeys) {
            const jobKey = `history:${k.exchange}:${k.code}`;
            const claimed = await repo.claimJob(jobKey, tpexWorkerId, 5 * 60 * 1000);
            if (claimed) {
                claimedTpexKeys.push(k);
            } else {
                summary.skipped++;
            }
        }

        if (claimedTpexKeys.length > 0) {
            try {
                // Plan dates using the first key as template
                const dateUnits = planTaiwanHistory(claimedTpexKeys[0], days, now);
                const trackedCodes = new Set(claimedTpexKeys.map(k => k.code));
                let successfulTpexUnits = 0;
                let tpexFailure: string | null = null;

                const existingBarsByKey = new Map<string, TaiwanBar[]>();
                for (const k of claimedTpexKeys) {
                    existingBarsByKey.set(k.code, await repo.readBars(k));
                }

                for (const k of claimedTpexKeys) {
                    await repo.writeHistoryStatus(k, {
                        state: 'running',
                        completed: 0,
                        total: dateUnits.length,
                        candleCount: existingBarsByKey.get(k.code)?.length || 0,
                        reason: null,
                    });
                }

                for (const unit of dateUnits) {
                    // Keep recent 5 trading days / current month eligible for re-fetch
                    const isEligible = unit.period >= cutoffDate || unit.period.slice(0, 7) === currentMonth;
                    if (!isEligible) {
                        const allHaveCompleted = claimedTpexKeys.every(k => {
                            const bars = existingBarsByKey.get(k.code);
                            return bars?.some(b => b.tradingDate === unit.period && b.complete);
                        });
                        if (allHaveCompleted) {
                            summary.skipped++;
                            successfulTpexUnits++;
                            continue;
                        }
                    }

                    try {
                        // Exactly ONE request for this date covers all TPEX keys!
                        const dayBars = await fetchTaiwanHistory(claimedTpexKeys[0], unit.period, request);
                        summary.requested++;
                        const matchedBars = dayBars.filter(b => trackedCodes.has(b.code));
                        if (matchedBars.length > 0) {
                            await repo.writeBars(matchedBars);
                            summary.written += matchedBars.length;
                            for (const b of matchedBars) {
                                const list = existingBarsByKey.get(b.code) || [];
                                list.push(b);
                                existingBarsByKey.set(b.code, list);
                            }
                        }
                        successfulTpexUnits++;
                    } catch (err) {
                        if (err instanceof TaiwanSourceError && err.reason === 'budget-limit') {
                            summary.failures.push('budget-limit');
                            for (const tpexKey of claimedTpexKeys) {
                                const existing = existingBarsByKey.get(tpexKey.code) || [];
                                await repo.writeHistoryStatus(tpexKey, {
                                    state: 'partial',
                                    completed: successfulTpexUnits,
                                    total: dateUnits.length,
                                    candleCount: existing.length,
                                    reason: 'budget-limit',
                                });
                            }
                            return summary;
                        }
                        const msg = err instanceof Error ? err.message : String(err);
                        summary.failures.push(msg);
                        tpexFailure = msg;
                        break;
                    }
                }

                for (const tpexKey of claimedTpexKeys) {
                    const existingBars = existingBarsByKey.get(tpexKey.code) || [];
                    if (tpexFailure) {
                        await repo.writeHistoryStatus(tpexKey, {
                            state: existingBars.length > 0 ? 'partial' : 'error',
                            completed: successfulTpexUnits,
                            total: dateUnits.length,
                            candleCount: existingBars.length,
                            reason: 'api-error',
                        });
                    } else {
                        await repo.writeHistoryStatus(tpexKey, {
                            state: successfulTpexUnits >= dateUnits.length ? 'ready' : 'partial',
                            completed: successfulTpexUnits,
                            total: dateUnits.length,
                            candleCount: existingBars.length,
                            reason: null,
                        });
                    }
                }
            } finally {
                for (const k of claimedTpexKeys) {
                    await repo.releaseJob(`history:${k.exchange}:${k.code}`, tpexWorkerId);
                }
            }
        }
    }

    return summary;
}

/**
 * Requests Taiwan history synchronization with deduplication, lease checking, and Inngest dispatch.
 * Returns disabled if history sync is not enabled.
 * If previous status was 'running' but worker crashed (lease expired), automatically recovers.
 */
export async function requestTaiwanHistory(
    key: TaiwanKey,
    days = 800,
    injectedRepo?: TaiwanRepository
): Promise<TaiwanHistoryStatus> {
    const config = loadTaiwanSyncConfig(process.env);
    if (!config || !config.historyEnabled) {
        return {
            state: 'disabled',
            completed: 0,
            total: 0,
            candleCount: 0,
            reason: 'missing-config',
        };
    }

    const repo = injectedRepo ?? createMongoTaiwanRepository();
    const current = await repo.readHistoryStatus(key);

    const jobKey = `history:${key.exchange}:${key.code}`;
    if (current.state === 'running') {
        // Probe if the job lease is actively held by an active worker
        const probeWorker = `probe-${Date.now()}`;
        const canClaim = await repo.claimJob(jobKey, probeWorker, 1000);
        if (!canClaim) {
            // Live worker is actively processing this job
            return current;
        }
        // Previous worker crashed or lease expired: release probe and recover to queued
        await repo.releaseJob(jobKey, probeWorker);
    } else if (current.state === 'queued' || current.state === 'ready') {
        return current;
    }

    // Attempt to dispatch Inngest background event
    try {
        const { inngest } = await import('../inngest/client');
        await inngest.send({
            name: 'taiwan/history.sync',
            data: { exchange: key.exchange, code: key.code, days },
        });
    } catch {
        // Continue if Inngest is not configured or in unit test environment
    }

    const queuedStatus: TaiwanHistoryStatus = {
        state: 'queued',
        completed: current.completed || 0,
        total: current.total || 0,
        candleCount: current.candleCount || 0,
        reason: null,
    };
    await repo.writeHistoryStatus(key, queuedStatus);
    return queuedStatus;
}
