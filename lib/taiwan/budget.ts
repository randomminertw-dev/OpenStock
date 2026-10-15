import {
    TaiwanSourceError,
    type TaiwanRepository,
    type TaiwanRequester,
    type TaiwanSyncConfig,
    type TaiwanUsageAmounts,
    type TaiwanUsageLimits,
} from './types';
import { withTaiwanRateLimit } from './limiter';

/**
 * Returns current date string in Asia/Taipei timezone (YYYY-MM-DD).
 */
export function getTaipeiDayString(date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

/**
 * Creates a budget-constrained, rate-limited, and retry-aware requester
 * compliant with zero-added-cost free quotas.
 */
export function createBudgetedRequest(
    repo: TaiwanRepository,
    config: TaiwanSyncConfig,
    underlyingFetch: typeof fetch = fetch
): TaiwanRequester {
    let lastRequestEnd = 0;
    let queue: Promise<unknown> = Promise.resolve();

    async function executeWithQueue<T>(fn: () => Promise<T>): Promise<T> {
        const nextInQueue = queue.then(async () => {
            const minInterval = config.minIntervalMs ?? 10000;
            const now = Date.now();
            const elapsed = now - lastRequestEnd;
            if (elapsed < minInterval) {
                await new Promise(resolve => setTimeout(resolve, minInterval - elapsed));
            }
            try {
                return await fn();
            } finally {
                lastRequestEnd = Date.now();
            }
        });
        queue = nextInQueue.catch(() => {});
        return nextInQueue;
    }

    return async function budgetedRequest(url: string, init?: RequestInit): Promise<unknown> {
        const minInterval = config.minIntervalMs ?? 10000;
        const requestKey = `${init?.method ?? 'GET'}:${url}`;
        return withTaiwanRateLimit(
            requestKey,
            async () => {
                return executeWithQueue(async () => {
                    const maxRetries = config.maxRetries ?? 2;
                    let attempt = 0;

            while (true) {
                const day = getTaipeiDayString();
                const reserveAmounts: TaiwanUsageAmounts = {
                    requests: 1,
                    jobs: 0,
                    transferBytes: config.maxResponseBytes,
                    storageBytes: 0,
                };
                const limits: TaiwanUsageLimits = {
                    requests: config.maxRequestsPerDay,
                    jobs: config.maxJobsPerDay,
                    transferBytes: config.maxTransferBytesPerDay,
                    storageBytes: config.maxStorageBytes,
                };

                const reserved = await repo.reserveUsage(day, reserveAmounts, limits);
                if (!reserved) {
                    throw new TaiwanSourceError(
                        'budget-limit',
                        'Daily Taiwan sync budget exceeded'
                    );
                }

                // Setup abort controller for timeout
                const timeoutMs = config.timeoutMs ?? 10000;
                const controller = new AbortController();
                const timer = setTimeout(() => {
                    controller.abort(new Error(`Request timeout after ${timeoutMs}ms`));
                }, timeoutMs);

                const signal = controller.signal;
                if (init?.signal) {
                    const outerSignal = init.signal;
                    if (outerSignal.aborted) {
                        clearTimeout(timer);
                        throw outerSignal.reason ?? new Error('Aborted');
                    }
                    outerSignal.addEventListener(
                        'abort',
                        () => controller.abort(outerSignal.reason),
                        { once: true }
                    );
                }

                try {
                    const fetchPromise = underlyingFetch(url, {
                        ...init,
                        signal,
                    });
                    const abortPromise = new Promise<never>((_, reject) => {
                        if (signal.aborted) {
                            reject(signal.reason ?? new Error(`Request timeout after ${timeoutMs}ms`));
                        } else {
                            signal.addEventListener(
                                'abort',
                                () =>
                                    reject(
                                        signal.reason ??
                                            new Error(`Request timeout after ${timeoutMs}ms`)
                                    ),
                                { once: true }
                            );
                        }
                    });

                    const response = await Promise.race([fetchPromise, abortPromise]);

                    // Check for retryable HTTP statuses (429 or 5xx)
                    if (response.status === 429 || response.status >= 500) {
                        // Refund reserved transfer bytes for this failed attempt
                        await repo.settleUsage(day, {
                            requests: 0,
                            jobs: 0,
                            transferBytes: -config.maxResponseBytes,
                            storageBytes: 0,
                        });

                        if (attempt < maxRetries) {
                            attempt++;
                            const minInterval = config.minIntervalMs ?? 10000;
                            await new Promise(resolve => setTimeout(resolve, minInterval));
                            continue;
                        }

                        throw new TaiwanSourceError(
                            'api-error',
                            `Upstream server returned HTTP ${response.status}`,
                            response.status
                        );
                    }

                    if (!response.ok) {
                        // Non-retryable error (e.g. 403, 404)
                        await repo.settleUsage(day, {
                            requests: 0,
                            jobs: 0,
                            transferBytes: -config.maxResponseBytes,
                            storageBytes: 0,
                        });
                        throw new TaiwanSourceError(
                            'api-error',
                            `Upstream request failed with status ${response.status}`,
                            response.status
                        );
                    }

                    // Stream response and strictly enforce maxResponseBytes
                    const chunks: Uint8Array[] = [];
                    let totalBytes = 0;

                    if (response.body && typeof response.body.getReader === 'function') {
                        const reader = response.body.getReader();
                        try {
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                if (value) {
                                    totalBytes += value.byteLength;
                                    if (totalBytes > config.maxResponseBytes) {
                                        await reader.cancel();
                                        throw new TaiwanSourceError(
                                            'budget-limit',
                                            `Response stream exceeded maxResponseBytes (${config.maxResponseBytes})`
                                        );
                                    }
                                    chunks.push(value);
                                }
                            }
                        } finally {
                            try {
                                reader.releaseLock?.();
                            } catch {}
                        }
                    } else {
                        const text = await response.text();
                        const encoded = new TextEncoder().encode(text);
                        totalBytes = encoded.length;
                        if (totalBytes > config.maxResponseBytes) {
                            throw new TaiwanSourceError(
                                'budget-limit',
                                `Response payload exceeded maxResponseBytes (${config.maxResponseBytes})`
                            );
                        }
                        chunks.push(encoded);
                    }

                    // Settle unused transfer bytes
                    const unused = Math.max(0, config.maxResponseBytes - totalBytes);
                    if (unused > 0) {
                        await repo.settleUsage(day, {
                            requests: 0,
                            jobs: 0,
                            transferBytes: -unused,
                            storageBytes: 0,
                        });
                    }

                    // Decode body
                    const totalBuffer = new Uint8Array(totalBytes);
                    let offset = 0;
                    for (const chunk of chunks) {
                        totalBuffer.set(chunk, offset);
                        offset += chunk.byteLength;
                    }

                    const decodedText = new TextDecoder().decode(totalBuffer);
                    const trimmed = decodedText.trim();
                    if (
                        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
                        (trimmed.startsWith('[') && trimmed.endsWith(']'))
                    ) {
                        try {
                            return JSON.parse(trimmed);
                        } catch {
                            return decodedText;
                        }
                    }
                    return decodedText;
                } catch (err: unknown) {
                    if (err instanceof TaiwanSourceError) {
                        throw err;
                    }
                    // Refund unused transfer bytes on network / timeout errors
                    await repo.settleUsage(day, {
                        requests: 0,
                        jobs: 0,
                        transferBytes: -config.maxResponseBytes,
                        storageBytes: 0,
                    });
                    throw err;
                } finally {
                    clearTimeout(timer);
                }
            }
        });
    }, { intervalMs: minInterval });
};
}
