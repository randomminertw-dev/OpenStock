import { describe, expect, it } from 'vitest';
import { loadTaiwanSyncConfig } from './config';

describe('TaiwanSyncConfig rate limiting configuration', () => {
    const baseEnv = {
        TAIWAN_AUTO_SYNC_ENABLED: 'true',
        TAIWAN_HISTORY_ENABLED: 'true',
        TAIWAN_MAX_REQUESTS_PER_DAY: '50',
        TAIWAN_MAX_JOBS_PER_DAY: '10',
        TAIWAN_MAX_TRANSFER_BYTES_PER_DAY: '20000000',
        TAIWAN_MAX_STORAGE_BYTES: '100000000',
        TAIWAN_MAX_TRACKED_SECURITIES: '200',
        TAIWAN_MAX_RESPONSE_BYTES: '6000000',
    };

    it('defaults minIntervalMs to 10000ms when env is unset', () => {
        const config = loadTaiwanSyncConfig(baseEnv);
        expect(config?.minIntervalMs).toBe(10000);
    });

    it('reads TAIWAN_UPSTREAM_MIN_INTERVAL_MS when set to a valid integer', () => {
        const config = loadTaiwanSyncConfig({
            ...baseEnv,
            TAIWAN_UPSTREAM_MIN_INTERVAL_MS: '15000',
        });
        expect(config?.minIntervalMs).toBe(15000);
    });

    it('falls back to 10000ms if TAIWAN_UPSTREAM_MIN_INTERVAL_MS is invalid or negative', () => {
        const config = loadTaiwanSyncConfig({
            ...baseEnv,
            TAIWAN_UPSTREAM_MIN_INTERVAL_MS: '-500',
        });
        expect(config?.minIntervalMs).toBe(10000);
    });
});
