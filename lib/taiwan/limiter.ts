import { TaiwanRateLimitModel } from '../../database/models/taiwan-rate-limit.model';

const inFlightRequests = new Map<string, Promise<unknown>>();
let inMemoryNextAllowedAt = 0;

export function resetInMemoryLimiter(): void {
    inMemoryNextAllowedAt = 0;
    inFlightRequests.clear();
}

/**
 * Coalesces concurrent in-flight executions for the exact same key.
 */
export async function deduplicateInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = inFlightRequests.get(key);
    if (existing) {
        return existing as Promise<T>;
    }

    const promise = (async () => {
        try {
            return await fn();
        } finally {
            inFlightRequests.delete(key);
        }
    })();

    inFlightRequests.set(key, promise);
    return promise;
}

/**
 * Atomically reserves a rate-limited time slot.
 * Uses MongoDB aggregation pipeline update if available, with in-memory fallback.
 */
export async function reserveTaiwanRequestSlot(options?: {
    intervalMs?: number;
    scope?: string;
    now?: number;
    model?: typeof TaiwanRateLimitModel;
}): Promise<{ reservedSlot: number; waitMs: number }> {
    const intervalMs = options?.intervalMs ?? 10000;
    const scope = options?.scope ?? 'taiwan-official';
    const now = options?.now ?? Date.now();
    const model = options?.model ?? TaiwanRateLimitModel;

    try {
        const isConnected = (model as any)?.db ? (model as any).db.readyState === 1 : true;
        if (isConnected && model && typeof model.findOneAndUpdate === 'function') {
            const res = await model.findOneAndUpdate(
                { _id: scope },
                [
                    {
                        $set: {
                            nextAllowedAt: {
                                $add: [
                                    {
                                        $max: [
                                            options?.now ? options.now : { $toLong: '$$NOW' },
                                            { $ifNull: ['$nextAllowedAt', 0] }
                                        ]
                                    },
                                    intervalMs
                                ]
                            },
                            lastReservedAt: options?.now ? options.now : { $toLong: '$$NOW' },
                            updatedAt: '$$NOW'
                        }
                    }
                ],
                { upsert: true, returnDocument: 'after' }
            );

            if (res && typeof res.nextAllowedAt === 'number') {
                const reservedSlot = res.nextAllowedAt - intervalMs;
                const waitMs = Math.max(0, reservedSlot - now);
                return { reservedSlot, waitMs };
            }
        }
    } catch {
        // Fall back to in-memory gatekeeper on MongoDB disconnection / mock environments
    }

    // In-memory atomic fallback
    const reservedSlot = Math.max(now, inMemoryNextAllowedAt);
    inMemoryNextAllowedAt = reservedSlot + intervalMs;
    const waitMs = Math.max(0, reservedSlot - now);
    return { reservedSlot, waitMs };
}

/**
 * Wraps an upstream task with In-Flight deduplication and atomic 10s rate limit pacing.
 */
export async function withTaiwanRateLimit<T>(
    key: string,
    fn: () => Promise<T>,
    options?: { intervalMs?: number; scope?: string }
): Promise<T> {
    return deduplicateInFlight(key, async () => {
        const { waitMs } = await reserveTaiwanRequestSlot(options);
        if (waitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
        return await fn();
    });
}
