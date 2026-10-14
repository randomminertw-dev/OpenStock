import { describe, expect, it } from 'vitest';
import { createResearchSnapshot } from './snapshot';
import { computeAll } from '@/lib/indicators';
import { computeFactors } from '@/lib/indicators/factors';
import { defaultFactorPreference } from '@/lib/indicators/factor-periods';
import type { SnapshotInput } from './types';
function input(): SnapshotInput {
    const end = Date.parse('2026-10-14T00:00:00Z') / 1000;
    return { symbol: 'BINANCE:BTCUSDT', source: { provider: 'binance', symbol: 'BTCUSDT', timeZone: 'UTC' },
        preference: defaultFactorPreference('crypto'), now: new Date('2026-10-15T12:00:00Z'),
        candles: Array.from({ length: 600 }, (_, i) => ({ t: end - (599 - i) * 86400, o: 100 + i, h: 103 + i, l: 99 + i, c: 102 + i, v: 1000 + i })) };
}
describe('pinned research snapshots', () => {
    it('uses the existing engines and explicit period policies on one daily input', () => {
        const raw = input(); const s = createResearchSnapshot(raw);
        const daily = raw.candles.filter(c => c.t * 1000 >= raw.candles.at(-1)!.t * 1000 - 400 * 86400000);
        expect(s.indicators.map(({ id, value, signal }) => ({ id, value, signal })))
            .toEqual(computeAll(daily, null).results.map(({ id, value, signal }) => ({ id, value, signal })));
        expect(s.factors).toEqual(computeFactors(raw.candles, raw.preference.periods));
        expect(s.idsPeriod.ATR.nullReason).toBe('non-directional');
        expect(s.profiles.map(p => p.periods.T)).toEqual([5, 21, 42]);
        expect(createResearchSnapshot({ ...raw, now: new Date('2026-10-15T13:00:00Z') }).inputHash).toBe(s.inputHash);
    });
    it('excludes the unfinished crypto day and marks absent volume without zero-vote fabrication', () => {
        const raw = input(); const last = raw.candles.at(-1)!;
        raw.candles.push({ ...last, t: last.t + 86400 }); raw.volumeComplete = false;
        const s = createResearchSnapshot(raw);
        expect(s.dataDate).toBe('2026-10-14');
        expect(s.indicators.filter(r => r.category === 'volume').every(r => r.signal === null)).toBe(true);
        expect(s.factors.V.score).toBeNull();
        expect(s.idsPeriod.CMF.nullReason).toBe('insufficient-data');
    });
    it('rejects duplicate daily sessions and invalid OHLCV', () => {
        const raw = input(); raw.candles.push({ ...raw.candles.at(-1)!, t: raw.candles.at(-1)!.t + 3600 });
        expect(() => createResearchSnapshot(raw)).toThrow();
        const bad = input(); bad.candles[0].h = 1;
        expect(() => createResearchSnapshot(bad)).toThrow();
    });
    it('cannot assign SPY data from another session or market to the snapshot', () => {
        const raw = input(); raw.symbol = 'AAPL'; raw.preference = defaultFactorPreference('us');
        raw.source = { provider: 'alpaca', symbol: 'AAPL', timeZone: 'America/New_York' };
        raw.benchmark = raw.candles.slice(0, -1);
        const s = createResearchSnapshot(raw);
        expect(s.warnings.join('')).toContain('比較基準');
        expect(s.indicators.find(r => r.id === 'beta252')?.signal).toBeNull();
    });
});
it('keeps the computed window and hash pinned when generation time crosses a wall-clock cutoff', () => {
    const raw = input();
    const early = createResearchSnapshot({ ...raw, now: new Date('2026-10-15T00:00:00Z') });
    const later = createResearchSnapshot({ ...raw, now: new Date('2026-10-15T12:00:00Z') });
    expect(early.indicators).toEqual(later.indicators);
    expect(early.inputHash).toBe(later.inputHash);
});
