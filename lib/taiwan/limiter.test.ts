import { describe, expect, it, vi, beforeEach } from 'vitest';
import { deduplicateInFlight, reserveTaiwanRequestSlot, withTaiwanRateLimit, resetInMemoryLimiter } from './limiter';

describe('Taiwan Global Rate Limiter', () => {
    beforeEach(() => {
        resetInMemoryLimiter();
    });

    describe('deduplicateInFlight', () => {
        it('coalesces concurrent requests for the same key into a single invocation', async () => {
            let count = 0;
            const factory = async () => {
                count++;
                await new Promise(resolve => setTimeout(resolve, 50));
                return 'result-' + count;
            };

            const [p1, p2, p3] = await Promise.all([
                deduplicateInFlight('same-key', factory),
                deduplicateInFlight('same-key', factory),
                deduplicateInFlight('same-key', factory),
            ]);

            expect(p1).toBe('result-1');
            expect(p2).toBe('result-1');
            expect(p3).toBe('result-1');
            expect(count).toBe(1);

            // Once resolved, subsequent call triggers a new invocation
            const p4 = await deduplicateInFlight('same-key', factory);
            expect(p4).toBe('result-2');
            expect(count).toBe(2);
        });

        it('cleans up in-flight promise if the function throws', async () => {
            let count = 0;
            const failingFactory = async () => {
                count++;
                throw new Error('fail');
            };

            await expect(deduplicateInFlight('err-key', failingFactory)).rejects.toThrow('fail');
            expect(count).toBe(1);

            // Should be able to retry
            const succeedingFactory = async () => {
                return 'recovered';
            };
            const res = await deduplicateInFlight('err-key', succeedingFactory);
            expect(res).toBe('recovered');
        });
    });

    describe('reserveTaiwanRequestSlot', () => {
        it('assigns successive slots spaced by intervalMs for concurrent calls', async () => {
            const now = 1000000;
            const res1 = await reserveTaiwanRequestSlot({ intervalMs: 10000, now });
            expect(res1.reservedSlot).toBe(now);
            expect(res1.waitMs).toBe(0);

            const res2 = await reserveTaiwanRequestSlot({ intervalMs: 10000, now: now + 500 });
            expect(res2.reservedSlot).toBe(now + 10000);
            expect(res2.waitMs).toBe(9500);

            const res3 = await reserveTaiwanRequestSlot({ intervalMs: 10000, now: now + 1000 });
            expect(res3.reservedSlot).toBe(now + 20000);
            expect(res3.waitMs).toBe(19000);
        });

        it('resets slot to current time after an idle duration exceeding intervalMs', async () => {
            const now = 1000000;
            await reserveTaiwanRequestSlot({ intervalMs: 10000, now });

            // Idle for 30 seconds
            const idleNow = now + 40000;
            const res = await reserveTaiwanRequestSlot({ intervalMs: 10000, now: idleNow });
            expect(res.reservedSlot).toBe(idleNow);
            expect(res.waitMs).toBe(0);
        });

        it('uses MongoDB model findOneAndUpdate when available', async () => {
            const fakeModel = {
                findOneAndUpdate: vi.fn().mockResolvedValue({
                    _id: 'taiwan-official',
                    nextAllowedAt: 1010000,
                    lastReservedAt: 1000000,
                }),
            };

            const res = await reserveTaiwanRequestSlot({
                intervalMs: 10000,
                now: 1000000,
                model: fakeModel as any,
            });

            expect(fakeModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
            expect(res.reservedSlot).toBe(1000000);
            expect(res.waitMs).toBe(0);
        });

        it('falls back to in-memory gatekeeper when MongoDB model throws', async () => {
            const fakeModel = {
                findOneAndUpdate: vi.fn().mockRejectedValue(new Error('MongoNetworkError')),
            };

            const res = await reserveTaiwanRequestSlot({
                intervalMs: 10000,
                now: 1000000,
                model: fakeModel as any,
            });

            expect(res.reservedSlot).toBe(1000000);
            expect(res.waitMs).toBe(0);
        });
    });

    describe('withTaiwanRateLimit', () => {
        it('executes task and respects the rate limit and deduplication', async () => {
            const executed: number[] = [];
            const action = async () => {
                executed.push(Date.now());
                return 'done';
            };

            const result = await withTaiwanRateLimit('test-url', action, { intervalMs: 10 });
            expect(result).toBe('done');
            expect(executed.length).toBe(1);
        });
    });
});
