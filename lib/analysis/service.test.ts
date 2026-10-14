import { describe, expect, it } from 'vitest';
import { createResearchReportService } from './service';
import type { ResearchReportRepository } from './repository';
import type { PublishedResearchReport } from './types';
import { createResearchSnapshot } from './snapshot';
import { defaultFactorPreference } from '@/lib/indicators/factor-periods';
function fixture() {
    return createResearchSnapshot({ symbol: 'BINANCE:BTCUSDT', source: { provider: 'binance', symbol: 'BTCUSDT', timeZone: 'UTC' },
        now: new Date('2026-10-15T12:00:00Z'), preference: defaultFactorPreference('crypto'),
        candles: Array.from({ length: 500 }, (_, i) => ({ t: Date.parse('2026-10-14T00:00:00Z') / 1000 - (499 - i) * 86400, o: 100 + i, h: 104 + i, l: 99 + i, c: 103 + i, v: 1000 })) });
}
function repository() {
    const values = new Map<string, PublishedResearchReport>(); let busy = false;
    const repo: ResearchReportRepository = {
        async list(owner, symbol) { return [...values.entries()].filter(([key, r]) => key.startsWith(owner + ':') && r.snapshot.symbol === symbol).map(([, r]) => r); },
        async find(owner, symbol, hash, rules) { return (await repo.list(owner, symbol)).find(r => r.snapshot.inputHash === hash && r.analysis.rulesVersion === rules) ?? null; },
        async save(owner, report) { values.set(owner + ':' + report.id, report); return report; },
        async claim() { if (busy) return false; busy = true; return true; },
        async release() { busy = false; },
    }; return repo;
}
describe('authenticated research service lifecycle', () => {
    it('publishes one complete document, reuses unchanged snapshots, and isolates owners', async () => {
        const repo = repository(); const service = createResearchReportService({ repo, load: async () => fixture() });
        const first = await service.generate('alice', 'BINANCE:BTCUSDT');
        expect(first.ok).toBe(true);
        const next = await service.generate('alice', 'BINANCE:BTCUSDT');
        expect(next).toMatchObject({ ok: true, reused: true });
        expect((await repo.list('alice', 'BINANCE:BTCUSDT'))).toHaveLength(1);
        expect(await service.list('bob', 'BINANCE:BTCUSDT')).toEqual([]);
    });
    it('does not replace the previous report when loading or persistence fails', async () => {
        const repo = repository();
        await createResearchReportService({ repo, load: async () => fixture() }).generate('alice', 'BINANCE:BTCUSDT');
        const previous = await repo.list('alice', 'BINANCE:BTCUSDT');
        const failed = createResearchReportService({ repo, load: async () => { throw new Error('private provider message'); } });
        expect(await failed.generate('alice', 'BINANCE:BTCUSDT')).toMatchObject({ ok: false, code: 'api-error' });
        const changed = fixture(); changed.inputHash = 'new-input';
        const broken = { ...repo, save: async () => { throw new Error('private database URI'); } };
        expect(await createResearchReportService({ repo: broken, load: async () => changed }).generate('alice', 'BINANCE:BTCUSDT'))
            .toMatchObject({ ok: false, code: 'persistence-error' });
        expect(await repo.list('alice', 'BINANCE:BTCUSDT')).toEqual(previous);
    });
    it('rejects parallel generation before doing a second market load', async () => {
        const repo = repository(); let complete!: (value: ReturnType<typeof fixture>) => void; let loads = 0;
        const service = createResearchReportService({ repo, load: async () => { loads++; return new Promise(resolve => { complete = resolve; }); } });
        const first = service.generate('alice', 'BINANCE:BTCUSDT');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(await service.generate('alice', 'BINANCE:BTCUSDT')).toMatchObject({ ok: false, code: 'busy' });
        expect(loads).toBe(1); complete(fixture()); expect((await first).ok).toBe(true);
    });
    it('does not save non-finite or oversized report input', async () => {
        const repo = repository(); const snapshot = fixture(); snapshot.referencePrice = NaN;
        expect((await createResearchReportService({ repo, load: async () => snapshot }).generate('alice', 'BINANCE:BTCUSDT')).ok).toBe(false);
        expect(await repo.list('alice', 'BINANCE:BTCUSDT')).toHaveLength(0);
    });
});
it('fences an expired generation after a newer lease has published', async () => {
    const repo = repository(); let time = 0; let currentToken = ''; let expires = 0; let finish!: (s: ReturnType<typeof fixture>) => void; let calls = 0;
    repo.claim = async (_owner, token, now) => { if (currentToken && expires > now.getTime()) return false; currentToken = token; expires = now.getTime() + 120000; return true; };
    repo.release = async (_owner, token) => { if (token === currentToken) currentToken = ''; };
    const save = repo.save;
    repo.save = async (owner, report, token) => { if (token !== currentToken || expires <= time) throw new Error('Lease expired'); return save(owner, report, token); };
    const service = createResearchReportService({ repo, now: () => new Date(time), load: async () => {
        if (++calls === 1) return new Promise(resolve => { finish = resolve; });
        return { ...fixture(), inputHash: 'newer-input' };
    } });
    const old = service.generate('alice', 'BINANCE:BTCUSDT');
    await new Promise(resolve => setTimeout(resolve, 0)); time = 121000;
    expect((await service.generate('alice', 'BINANCE:BTCUSDT')).ok).toBe(true);
    finish(fixture()); expect(await old).toMatchObject({ ok: false, code: 'persistence-error' });
    expect((await service.list('alice', 'BINANCE:BTCUSDT')).map(r => r.snapshot.inputHash)).toEqual(['newer-input']);
});
