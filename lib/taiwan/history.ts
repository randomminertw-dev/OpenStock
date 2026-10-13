import { getTaipeiDayString } from './budget';
import { loadTaiwanSyncConfig } from './config';
import { createMongoTaiwanRepository } from './repository';
import { fetchTaiwanHistory } from './sources';
import {
    TaiwanSourceError,
    type HistoryUnit,
    type SyncSummary,
    type TaiwanHistoryStatus,
    type TaiwanKey,
    type TaiwanRepository,
    type TaiwanRequester,
} from './types';

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
 * Enforces TPEX batch sharing (1 request per date covers all tracked TPEX keys).
 * Preserves successfully written bars upon upstream errors.
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

    const twseKeys = keys.filter(k => k.exchange === 'TWSE');
    const tpexKeys = keys.filter(k => k.exchange === 'TPEX');

    // 1. Process TWSE keys (per-symbol monthly requests)
    for (const twseKey of twseKeys) {
        const units = planTaiwanHistory(twseKey, days, now);
        let successfulUnits = 0;
        let keyFailure: string | null = null;

        for (const unit of units) {
            try {
                const bars = await fetchTaiwanHistory(twseKey, unit.period, request);
                summary.requested++;
                if (bars && bars.length > 0) {
                    await repo.writeBars(bars);
                    summary.written += bars.length;
                }
                successfulUnits++;
            } catch (err) {
                if (err instanceof TaiwanSourceError && err.reason === 'budget-limit') {
                    summary.failures.push('budget-limit');
                    const existing = await repo.readBars(twseKey);
                    await repo.writeHistoryStatus(twseKey, {
                        state: 'partial',
                        completed: successfulUnits,
                        total: units.length,
                        candleCount: existing.length,
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

        const existingBars = await repo.readBars(twseKey);
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
                state: 'ready',
                completed: units.length,
                total: units.length,
                candleCount: existingBars.length,
                reason: null,
            });
        }
    }

    // 2. Process TPEX keys (shared daily requests)
    if (tpexKeys.length > 0) {
        // Plan dates using the first key as template
        const dateUnits = planTaiwanHistory(tpexKeys[0], days, now);
        const trackedCodes = new Set(tpexKeys.map(k => k.code));
        let successfulTpexUnits = 0;
        let tpexFailure: string | null = null;

        for (const unit of dateUnits) {
            try {
                // Exactly ONE request for this date covers all TPEX keys!
                const dayBars = await fetchTaiwanHistory(tpexKeys[0], unit.period, request);
                summary.requested++;
                const matchedBars = dayBars.filter(b => trackedCodes.has(b.code));
                if (matchedBars.length > 0) {
                    await repo.writeBars(matchedBars);
                    summary.written += matchedBars.length;
                }
                successfulTpexUnits++;
            } catch (err) {
                if (err instanceof TaiwanSourceError && err.reason === 'budget-limit') {
                    summary.failures.push('budget-limit');
                    for (const tpexKey of tpexKeys) {
                        const existing = await repo.readBars(tpexKey);
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

        for (const tpexKey of tpexKeys) {
            const existingBars = await repo.readBars(tpexKey);
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
                    state: 'ready',
                    completed: dateUnits.length,
                    total: dateUnits.length,
                    candleCount: existingBars.length,
                    reason: null,
                });
            }
        }
    }

    return summary;
}

/**
 * Requests Taiwan history synchronization with deduplication and Inngest dispatch.
 * Returns disabled if history sync is not enabled.
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

    if (current.state === 'running' || current.state === 'queued') {
        return current;
    }
    if (current.state === 'ready') {
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
        completed: 0,
        total: 0,
        candleCount: current.candleCount || 0,
        reason: null,
    };
    await repo.writeHistoryStatus(key, queuedStatus);
    return queuedStatus;
}
