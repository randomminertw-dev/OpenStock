import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaiwanOnDemand } from './on-demand';
import { createInMemoryTaiwanRepository } from './repository';

const limitKeys = ['TAIWAN_MAX_REQUESTS_PER_DAY', 'TAIWAN_MAX_JOBS_PER_DAY',
    'TAIWAN_MAX_TRANSFER_BYTES_PER_DAY', 'TAIWAN_MAX_STORAGE_BYTES',
    'TAIWAN_MAX_TRACKED_SECURITIES', 'TAIWAN_MAX_RESPONSE_BYTES'];
const key = { exchange: 'TWSE' as const, code: '2330' };
let warning: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    limitKeys.forEach(k => vi.stubEnv(k, ''));
    warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('safe diagnostics for deployed Taiwan loading failures', () => {
    it('identifies the missing limit names when configuration blocks requests before fetch', async () => {
        vi.stubEnv('TAIWAN_MAX_REQUESTS_PER_DAY', '200');
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const loader = createTaiwanOnDemand({ repo: createInMemoryTaiwanRepository() });
        await expect(loader.catalog()).rejects.toThrow();
        expect((await loader.history(key, 800)).status.reason).toBe('missing-config');
        expect(fetch).not.toHaveBeenCalled();
        expect(warning).toHaveBeenCalledWith('[taiwan-data]', expect.objectContaining({
            event: 'limits-invalid', missing: limitKeys.slice(1), invalid: [],
        }));
    });

    it('distinguishes a database operation failure without logging its sensitive message', async () => {
        const repo = createInMemoryTaiwanRepository();
        repo.readCatalog = async () => { throw Object.assign(new Error('mongodb://private-password@private-host'), { code: 13 }); };
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const loader = createTaiwanOnDemand({ repo });
        await expect(loader.catalog()).rejects.toThrow();
        expect((await loader.history(key, 800)).status.reason).toBe('missing-config');
        expect(warning).toHaveBeenCalledWith('[taiwan-data]', expect.objectContaining({
            event: 'cache-failure', operation: 'readCatalog', code: 13,
        }));
        expect(JSON.stringify(warning.mock.calls)).not.toContain('private-password');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('distinguishes official HTTP rejection from a configuration failure', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('private-response-body', { status: 403 })));
        const loader = createTaiwanOnDemand({ repo: createInMemoryTaiwanRepository() });
        expect((await loader.history(key, 800)).status.reason).toBe('api-error');
        expect(warning).toHaveBeenCalledWith('[taiwan-data]', expect.objectContaining({
            event: 'upstream-failure', host: 'www.twse.com.tw', path: '/exchangeReport/STOCK_DAY',
            reason: 'api-error', status: 403,
        }));
        expect(JSON.stringify(warning.mock.calls)).not.toContain('private-response-body');
    });
});
