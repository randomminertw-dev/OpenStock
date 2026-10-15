import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createInMemoryTaiwanRepository } from '../lib/taiwan/repository';
import { createBudgetedRequest } from '../lib/taiwan/budget';
import { resetInMemoryLimiter } from '../lib/taiwan/limiter';
import type { TaiwanSyncConfig } from '../lib/taiwan/types';

describe('Taiwan Official Rate Limiting E2E', () => {
    beforeEach(() => {
        resetInMemoryLimiter();
    });

    const testConfig: TaiwanSyncConfig = {
        autoSyncEnabled: true,
        historyEnabled: true,
        maxRequestsPerDay: 100,
        maxJobsPerDay: 50,
        maxTransferBytesPerDay: 100000000,
        maxStorageBytes: 100000000,
        maxTrackedSecurities: 50,
        maxResponseBytes: 10000000,
        upstreamConcurrency: 1,
        minIntervalMs: 50, // Use 50ms in test for fast execution
        timeoutMs: 10000,
        maxRetries: 2,
    };

    it('smoothly spaces 4 concurrent requests from distinct callers without burst', async () => {
        const repo = createInMemoryTaiwanRepository();
        const callTimes: number[] = [];

        const mockFetch = vi.fn().mockImplementation(async (url: string) => {
            callTimes.push(Date.now());
            return new Response(JSON.stringify({ ok: true, url }), { status: 200 });
        });

        // Warm up JIT and Intl formatting so initial execution overhead doesn't skew interval timing
        const warmup = createBudgetedRequest(repo, testConfig, async () => new Response('{}'));
        await warmup('https://openapi.twse.com.tw/v1/warmup');
        resetInMemoryLimiter();

        // 4 distinct requester instances
        const r1 = createBudgetedRequest(repo, testConfig, mockFetch);
        const r2 = createBudgetedRequest(repo, testConfig, mockFetch);
        const r3 = createBudgetedRequest(repo, testConfig, mockFetch);
        const r4 = createBudgetedRequest(repo, testConfig, mockFetch);

        await Promise.all([
            r1('https://openapi.twse.com.tw/v1/a'),
            r2('https://openapi.twse.com.tw/v1/b'),
            r3('https://openapi.twse.com.tw/v1/c'),
            r4('https://openapi.twse.com.tw/v1/d'),
        ]);

        expect(mockFetch).toHaveBeenCalledTimes(4);
        for (let i = 1; i < callTimes.length; i++) {
            const gap = callTimes[i] - callTimes[i - 1];
            expect(gap).toBeGreaterThanOrEqual(40);
        }
    });

    it('deduplicates identical requests issued concurrently across instances', async () => {
        const repo = createInMemoryTaiwanRepository();
        const mockFetch = vi.fn().mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 30));
            return new Response(JSON.stringify({ stat: 'OK' }), { status: 200 });
        });

        const r1 = createBudgetedRequest(repo, testConfig, mockFetch);
        const r2 = createBudgetedRequest(repo, testConfig, mockFetch);

        const [res1, res2] = await Promise.all([
            r1('https://openapi.twse.com.tw/v1/duplicate'),
            r2('https://openapi.twse.com.tw/v1/duplicate'),
        ]);

        expect(res1).toEqual({ stat: 'OK' });
        expect(res2).toEqual({ stat: 'OK' });
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});
