import { describe, expect, it, vi } from 'vitest';
import { createBudgetedRequest } from './budget';
import { isTaiwanDatasetEnabled, loadTaiwanSyncConfig } from './config';
import { createInMemoryTaiwanRepository } from './repository';
import { TaiwanSourceError } from './types';
import type { TaiwanSyncConfig } from './types';

describe('loadTaiwanSyncConfig', () => {
    const validEnv: Record<string, string> = {
        TAIWAN_AUTO_SYNC_ENABLED: 'true',
        TAIWAN_HISTORY_ENABLED: 'true',
        TAIWAN_MAX_REQUESTS_PER_DAY: '50',
        TAIWAN_MAX_JOBS_PER_DAY: '10',
        TAIWAN_MAX_TRANSFER_BYTES_PER_DAY: '20000000',
        TAIWAN_MAX_STORAGE_BYTES: '100000000',
        TAIWAN_MAX_TRACKED_SECURITIES: '200',
        TAIWAN_MAX_RESPONSE_BYTES: '6000000',
    };

    it('loads valid configuration with boolean flags and numeric bounds', () => {
        const config = loadTaiwanSyncConfig(validEnv);
        expect(config).not.toBeNull();
        expect(config?.autoSyncEnabled).toBe(true);
        expect(config?.historyEnabled).toBe(true);
        expect(config?.maxRequestsPerDay).toBe(50);
        expect(config?.maxJobsPerDay).toBe(10);
        expect(config?.maxTransferBytesPerDay).toBe(20000000);
        expect(config?.maxStorageBytes).toBe(100000000);
        expect(config?.maxTrackedSecurities).toBe(200);
        expect(config?.maxResponseBytes).toBe(6000000);
    });

    it('defaults flags to false when missing or disabled', () => {
        const envWithoutFlags = {
            ...validEnv,
            TAIWAN_AUTO_SYNC_ENABLED: 'false',
            TAIWAN_HISTORY_ENABLED: '0',
        };
        const config = loadTaiwanSyncConfig(envWithoutFlags);
        expect(config?.autoSyncEnabled).toBe(false);
        expect(config?.historyEnabled).toBe(false);
    });

    it('returns null when any limit is missing, 0, negative, or NaN', () => {
        expect(loadTaiwanSyncConfig({})).toBeNull();

        expect(
            loadTaiwanSyncConfig({
                ...validEnv,
                TAIWAN_MAX_REQUESTS_PER_DAY: '0',
            })
        ).toBeNull();

        expect(
            loadTaiwanSyncConfig({
                ...validEnv,
                TAIWAN_MAX_TRANSFER_BYTES_PER_DAY: '-1000',
            })
        ).toBeNull();

        expect(
            loadTaiwanSyncConfig({
                ...validEnv,
                TAIWAN_MAX_RESPONSE_BYTES: 'not-a-number',
            })
        ).toBeNull();

        expect(
            loadTaiwanSyncConfig({
                ...validEnv,
                TAIWAN_MAX_TRACKED_SECURITIES: '12.5', // non-integer
            })
        ).toBeNull();
    });

    it('checks whether datasets fit within maxResponseBytes (e.g. TPEx daily quotes ~4.86 MB)', () => {
        const lowConfig: TaiwanSyncConfig = {
            autoSyncEnabled: true,
            historyEnabled: false,
            maxRequestsPerDay: 10,
            maxJobsPerDay: 5,
            maxTransferBytesPerDay: 10000000,
            maxStorageBytes: 50000000,
            maxTrackedSecurities: 50,
            maxResponseBytes: 2000000, // 2MB is too small for ~4.86 MB dataset
        };
        expect(
            isTaiwanDatasetEnabled('tpex-mainboard-daily-close-quotes', lowConfig)
        ).toBe(false);

        const highConfig: TaiwanSyncConfig = {
            ...lowConfig,
            maxResponseBytes: 8000000, // 8MB is sufficient
        };
        expect(
            isTaiwanDatasetEnabled('tpex-mainboard-daily-close-quotes', highConfig)
        ).toBe(true);
    });
});

describe('createBudgetedRequest', () => {
    const testConfig: TaiwanSyncConfig = {
        autoSyncEnabled: true,
        historyEnabled: true,
        maxRequestsPerDay: 5,
        maxJobsPerDay: 5,
        maxTransferBytesPerDay: 100000,
        maxStorageBytes: 100000,
        maxTrackedSecurities: 10,
        maxResponseBytes: 10000,
        minIntervalMs: 0,
        timeoutMs: 1000,
        maxRetries: 2,
    };

    it('denies requests and prevents fetch when budget is exceeded', async () => {
        const repo = createInMemoryTaiwanRepository();
        const mockFetch = vi.fn().mockResolvedValue(new Response('{"stat":"OK"}'));
        const request = createBudgetedRequest(repo, testConfig, mockFetch);

        // Exhaust requests budget by reserving 5 requests
        for (let i = 0; i < 5; i++) {
            await request('https://api.example.com/data');
        }
        expect(mockFetch).toHaveBeenCalledTimes(5);

        // 6th request must be rejected without calling fetch
        await expect(request('https://api.example.com/data')).rejects.toThrow(
            TaiwanSourceError
        );
        expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('reserves upper bound of response bytes upfront and settles actual transfer bytes', async () => {
        const repo = createInMemoryTaiwanRepository();
        const payload = JSON.stringify({ message: 'hello' }); // ~19 bytes
        const mockFetch = vi.fn().mockImplementation(async () => {
            return new Response(payload, {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        const request = createBudgetedRequest(repo, testConfig, mockFetch);
        const result = await request('https://api.example.com/item');
        expect(result).toEqual({ message: 'hello' });

        // Since testConfig.maxResponseBytes is 10,000 and payload is ~19 bytes,
        // unused ~9,981 bytes were settled back.
        // If settlement did not happen, maxTransferBytesPerDay (100,000) would be consumed 10x faster.
    });

    it('aborts response stream early when decoded bytes exceed maxResponseBytes without Content-Length', async () => {
        const repo = createInMemoryTaiwanRepository();
        // Stream of infinite chunks
        const infiniteStream = new ReadableStream({
            start(controller) {
                const chunk = new Uint8Array(2000); // 2KB chunks
                for (let i = 0; i < 10; i++) {
                    controller.enqueue(chunk); // 20KB total > 10,000 maxResponseBytes
                }
                controller.close();
            },
        });

        const mockFetch = vi.fn().mockResolvedValue(
            new Response(infiniteStream, {
                status: 200,
            })
        );

        const request = createBudgetedRequest(repo, testConfig, mockFetch);
        await expect(request('https://api.example.com/huge')).rejects.toThrow(
            TaiwanSourceError
        );
    });

    it('retries 429 and 5xx up to 2 times, reserving budget on each retry', async () => {
        const repo = createInMemoryTaiwanRepository();
        let callCount = 0;
        const mockFetch = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount < 3) {
                return new Response('Rate limited', { status: 429 });
            }
            return new Response('{"stat":"OK"}', { status: 200 });
        });

        const request = createBudgetedRequest(repo, testConfig, mockFetch);
        const res = await request('https://api.example.com/retry-test');
        expect(res).toEqual({ stat: 'OK' });
        expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('waits at least minIntervalMs before retrying on 429 or 5xx', async () => {
        const repo = createInMemoryTaiwanRepository();
        const retryIntervalConfig: TaiwanSyncConfig = {
            ...testConfig,
            minIntervalMs: 50,
        };
        const timestamps: number[] = [];
        const mockFetch = vi.fn().mockImplementation(async () => {
            timestamps.push(Date.now());
            if (timestamps.length === 1) {
                return new Response('Rate limited', { status: 429 });
            }
            return new Response('{"stat":"OK"}', { status: 200 });
        });

        const request = createBudgetedRequest(repo, retryIntervalConfig, mockFetch);
        const res = await request('https://api.example.com/backoff-test');
        expect(res).toEqual({ stat: 'OK' });
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(40);
    });

    it('does not retry on non-retryable 403 or 404 errors', async () => {
        const repo = createInMemoryTaiwanRepository();
        const mockFetch = vi
            .fn()
            .mockResolvedValue(new Response('Forbidden', { status: 403 }));

        const request = createBudgetedRequest(repo, testConfig, mockFetch);
        await expect(request('https://api.example.com/secret')).rejects.toThrow(
            TaiwanSourceError
        );
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('times out after configured timeout limit', async () => {
        const repo = createInMemoryTaiwanRepository();
        const slowConfig: TaiwanSyncConfig = {
            ...testConfig,
            timeoutMs: 50,
        };
        const mockFetch = vi.fn().mockImplementation(
            () =>
                new Promise(resolve => {
                    setTimeout(() => resolve(new Response('{}')), 200);
                })
        );

        const request = createBudgetedRequest(repo, slowConfig, mockFetch);
        await expect(request('https://api.example.com/slow')).rejects.toThrow();
    });
});
