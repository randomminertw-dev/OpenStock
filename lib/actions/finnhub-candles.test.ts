import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/better-auth/auth', () => ({ getSession: vi.fn().mockResolvedValue(null) }));
beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('FINNHUB_API_KEYS', 'test-key');
    vi.stubEnv('NEXT_PUBLIC_FINNHUB_API_KEY', '');
    vi.stubEnv('FINNHUB_API_KEY', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([
    [200, { s: 'no_data' }, 'no-data'],
    [200, { s: 'ok', c: [] }, 'no-data'],
    [401, {}, 'missing-config'],
    [403, {}, 'missing-config'],
    [429, {}, 'api-error'],
    [200, { s: 'ok', c: [100] }, 'api-error'],
])('preserves Finnhub HTTP %s / %s failure classification', async (status, data, reason) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => data }));
    const api = await import('./finnhub.actions');
    expect(await api.getCandlesWithReason('AAPL')).toMatchObject({ candles: null, reason });
    expect(await api.getCandles('AAPL')).toBeNull();
});

it('returns missing-config without requesting data when no Finnhub key exists', async () => {
    vi.stubEnv('FINNHUB_API_KEYS', '');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const api = await import('./finnhub.actions');
    expect(await api.getCandlesWithReason('AAPL')).toMatchObject({ candles: null, reason: 'missing-config' });
    expect(fetcher).not.toHaveBeenCalled();
});

it('preserves valid candles and sends credentials only in headers', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
        s: 'ok', t: [1791504000], o: [100], h: [108], l: [99], c: [105], v: [1234],
    }) });
    vi.stubGlobal('fetch', fetcher);
    const api = await import('./finnhub.actions');
    expect(await api.getCandles('AAPL')).toMatchObject({ s: 'ok', c: [105], v: [1234] });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).not.toContain('test-key');
    expect(init.headers['X-Finnhub-Token']).toBe('test-key');
});
