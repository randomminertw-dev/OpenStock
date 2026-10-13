import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    requireUserId: vi.fn(), connect: vi.fn(), findOne: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.requireUserId }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/database/models/factor-preference.model', () => ({
    FactorPreferenceModel: { findOne: mocks.findOne, findOneAndUpdate: mocks.update },
}));
import { getFactorPreference, saveFactorPreference } from './factor-preferences.actions';

const input = (market = 'us', n = 21, interval: string | null = null) => ({
    market, preset: 'custom', periods: { T: n, M: n, V: n, R: n }, interval,
});

describe('factor preferences session and market storage', () => {
    it('defines a unique account and market index on the independent model', async () => {
        const { FactorPreferenceModel } = await vi.importActual<typeof import('@/database/models/factor-preference.model')>('@/database/models/factor-preference.model');
        expect(FactorPreferenceModel.schema.indexes()).toContainEqual([
            { userId: 1, market: 1 }, expect.objectContaining({ unique: true }),
        ]);
    });
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.requireUserId.mockResolvedValue('session-user');
        mocks.connect.mockResolvedValue(undefined);
        mocks.findOne.mockResolvedValue(null);
        mocks.update.mockResolvedValue({});
    });

    it.each([['AAPL', 'us', null], ['TWSE:2330', 'taiwan', null], ['CG:bitcoin', 'crypto', '1d']])(
        'defaults missing preferences for %s', async (symbol, market, interval) => {
            expect(await getFactorPreference(symbol!)).toEqual({
                preference: { market, preset: 'legacy', periods: { T: 14, M: 14, V: 14, R: 14 }, interval },
                readError: false,
            });
        },
    );

    it('isolates two accounts and three markets while sharing preferences across symbols', async () => {
        const records = new Map<string, unknown>();
        mocks.update.mockImplementation(async (filter, update) => {
            records.set(JSON.stringify(filter), update.$set);
            return update.$set;
        });
        mocks.findOne.mockImplementation(async filter => records.get(JSON.stringify(filter)) ?? null);
        for (const user of ['alice', 'bob']) {
            mocks.requireUserId.mockResolvedValue(user);
            await saveFactorPreference('AAPL', input('us', user === 'alice' ? 21 : 7));
            await saveFactorPreference('TWSE:2330', input('taiwan', 30));
            await saveFactorPreference('BINANCE:BTCUSDT', input('crypto', 180, '4h'));
        }
        expect(records.size).toBe(6);
        for (const user of ['alice', 'bob']) {
            mocks.requireUserId.mockResolvedValue(user);
            expect(await getFactorPreference('MSFT')).toMatchObject({ preference: { periods: { T: user === 'alice' ? 21 : 7 } } });
            expect(await getFactorPreference('TPEX:6488')).toMatchObject({ preference: { periods: { T: 30 } } });
            expect(await getFactorPreference('CG:ethereum')).toMatchObject({ preference: { periods: { T: 180 }, interval: '4h' } });
        }
    });

    it('takes the account only from session and rejects forged markets', async () => {
        await saveFactorPreference('CG:bitcoin', { ...input('crypto', 30, '8h'), userId: 'victim' });
        expect(mocks.update.mock.calls[0][0]).toEqual({ userId: 'session-user', market: 'crypto' });
        expect(mocks.update.mock.calls[0][1].$set).not.toHaveProperty('userId');
        await expect(saveFactorPreference('AAPL', input('crypto', 30, '8h'))).rejects.toThrow();
        expect(mocks.update).toHaveBeenCalledTimes(1);
    });

    it.each([input('us', 4), input('us', 127), input('us', 5.5), input('crypto', 181, '1d'), input('crypto', 14, '2h'), input('us', 14, '4h')])(
        'rejects invalid periods and intervals before writing: %j', async value => {
            await expect(saveFactorPreference(value.market === 'crypto' ? 'CG:bitcoin' : 'AAPL', value)).rejects.toThrow();
            expect(mocks.update).not.toHaveBeenCalled();
        },
    );

    it.each(['4h', '8h', '12h', '1d'])('accepts crypto interval %s and boundary N', async interval => {
        expect(await saveFactorPreference('CG:bitcoin', input('crypto', 5, interval))).toMatchObject({ interval, periods: { T: 5 } });
        expect(await saveFactorPreference('AAPL', input('us', 126))).toMatchObject({ periods: { T: 126 } });
    });

    it('returns null for unsupported markets and rejects saving them', async () => {
        expect(await getFactorPreference('LSE:VOD')).toBeNull();
        await expect(saveFactorPreference('LSE:VOD', input())).rejects.toThrow();
        expect(mocks.findOne).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('does not mask unauthenticated sessions as read fallback', async () => {
        mocks.requireUserId.mockRejectedValue(new Error('Unauthorized'));
        await expect(getFactorPreference('AAPL')).rejects.toThrow('Unauthorized');
        await expect(saveFactorPreference('AAPL', input())).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled();
    });

    it('warns when reads or stored data are invalid', async () => {
        mocks.findOne.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(input('us', 3));
        for (let i = 0; i < 2; i++) {
            expect(await getFactorPreference('AAPL')).toMatchObject({ readError: true, preference: { periods: { T: 14 } } });
        }
    });

    it('warns when connection fails during read and propagates failed saves', async () => {
        mocks.connect.mockRejectedValueOnce(new Error('offline'));
        expect(await getFactorPreference('CG:bitcoin')).toMatchObject({ readError: true, preference: { interval: '1d' } });
        mocks.update.mockRejectedValueOnce(new Error('write failed'));
        await expect(saveFactorPreference('AAPL', input())).rejects.toThrow('write failed');
    });
});
