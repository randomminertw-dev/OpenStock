import type { TaiwanDatasetId, TaiwanSyncConfig } from './types';

/**
 * Known approximate dataset payload sizes for budget safety.
 * TPEx daily quotes is ~4.86 MB (12,421 rows).
 */
export const ESTIMATED_DATASET_BYTES: Partial<Record<TaiwanDatasetId, number>> = {
    'tpex-mainboard-daily-close-quotes': 4_860_000,
    'twse-stock-day-all': 1_500_000,
};

function parsePositiveInteger(raw: string | undefined): number | null {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const num = Number(trimmed);
    if (!Number.isInteger(num) || num <= 0) return null;
    return num;
}

/**
 * Loads and validates Taiwan synchronization configuration from environment variables.
 * Returns null if any required quota/limit is missing, zero, negative, non-integer, or NaN.
 */
export function loadTaiwanSyncConfig(
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): TaiwanSyncConfig | null {
    const maxRequestsPerDay = parsePositiveInteger(env.TAIWAN_MAX_REQUESTS_PER_DAY);
    const maxJobsPerDay = parsePositiveInteger(env.TAIWAN_MAX_JOBS_PER_DAY);
    const maxTransferBytesPerDay = parsePositiveInteger(env.TAIWAN_MAX_TRANSFER_BYTES_PER_DAY);
    const maxStorageBytes = parsePositiveInteger(env.TAIWAN_MAX_STORAGE_BYTES);
    const maxTrackedSecurities = parsePositiveInteger(env.TAIWAN_MAX_TRACKED_SECURITIES);
    const maxResponseBytes = parsePositiveInteger(env.TAIWAN_MAX_RESPONSE_BYTES);

    if (
        maxRequestsPerDay === null ||
        maxJobsPerDay === null ||
        maxTransferBytesPerDay === null ||
        maxStorageBytes === null ||
        maxTrackedSecurities === null ||
        maxResponseBytes === null
    ) {
        return null;
    }

    const autoSyncEnabled = env.TAIWAN_AUTO_SYNC_ENABLED === 'true';
    const historyEnabled = env.TAIWAN_HISTORY_ENABLED === 'true';

    const rawMinInterval = parsePositiveInteger(env.TAIWAN_UPSTREAM_MIN_INTERVAL_MS);
    const minIntervalMs = rawMinInterval !== null && rawMinInterval >= 1000 ? rawMinInterval : 10000;

    return {
        autoSyncEnabled,
        historyEnabled,
        maxRequestsPerDay,
        maxJobsPerDay,
        maxTransferBytesPerDay,
        maxStorageBytes,
        maxTrackedSecurities,
        maxResponseBytes,
        upstreamConcurrency: 1,
        minIntervalMs,
        timeoutMs: 10000,
        maxRetries: 2,
    };
}

/**
 * Checks whether a given dataset can safely be synchronized under the current response byte limit.
 */
export function isTaiwanDatasetEnabled(id: TaiwanDatasetId, config: TaiwanSyncConfig): boolean {
    const estimated = ESTIMATED_DATASET_BYTES[id];
    if (estimated && config.maxResponseBytes < estimated) {
        return false;
    }
    return true;
}
