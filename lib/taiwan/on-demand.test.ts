import { describe, expect, it, vi } from 'vitest';
import { createInMemoryTaiwanRepository } from './repository';
import { createTaiwanOnDemand } from './on-demand';
import type { TaiwanRequester } from './types';

const companies = [{ '公司代號': '2330', '公司簡稱': '台積電', '公司名稱': '台灣積體電路製造股份有限公司', '普通股每股面額': '新台幣10元', '出表日期': '1151014' }];
const etfs = [{ '基金代號': '0050', '基金簡稱': '元大台灣50', '出表日期': '1151014' }];
function upstream() {
    return vi.fn<TaiwanRequester>(async url => {
        if (url.includes('t187ap03_L')) return companies;
        if (url.includes('t187ap47_L')) return etfs;
        if (url.includes('etfFilter')) return { data: [] };
        if (url.includes('STOCK_DAY?')) {
            const month = new URL(url).searchParams.get('date')!.slice(0, 6);
            const y = Number(month.slice(0, 4)) - 1911;
            const m = month.slice(4, 6);
            return { stat: 'OK', date: month + '01', title: '2330 台積電',
                fields: ['日期', '成交股數', '開盤價', '最高價', '最低價', '收盤價', '漲跌價差'],
                data: [[`${y}/${m}/01`, '1,200,001', '100', '105', '99', '104', '4']] };
        }
        return [];
    });
}

describe('automatic official Taiwan loading', () => {
    it('bootstraps stocks and ETFs on first use with background synchronization disabled', async () => {
        const repo = createInMemoryTaiwanRepository();
        const load = createTaiwanOnDemand({ repo, request: upstream() });
        const [a, b] = await Promise.all([load.catalog(), load.catalog()]);
        expect(a.map(s => s.symbol)).toEqual(['TWSE:0050', 'TWSE:2330']);
        expect(b).toEqual(a);
        expect((await repo.readCatalog()).map(s => s.code)).toEqual(['0050', '2330']);
    });

    it('shares catalog requests and serves valid cache without requesting again', async () => {
        const request = upstream();
        const load = createTaiwanOnDemand({ repo: createInMemoryTaiwanRepository(), request });
        await Promise.all([load.catalog(), load.catalog(), load.catalog()]);
        const firstRequests = request.mock.calls.length;
        await load.catalog();
        expect(request.mock.calls.length).toBe(firstRequests);
        expect(firstRequests).toBe(4);
    });

    it('retains a working catalog when a later refresh fails', async () => {
        let now = new Date('2026-10-14T03:00:00Z');
        const request = upstream();
        const load = createTaiwanOnDemand({ repo: createInMemoryTaiwanRepository(), request, now: () => now });
        await load.catalog();
        now = new Date('2026-10-16T03:00:00Z');
        request.mockRejectedValue(new Error('offline'));
        expect((await load.catalog()).find(s => s.code === '2330')?.name).toBe('台積電');
    });

    it('loads official closing history in bounded batches and resumes on the next request', async () => {
        let now = new Date('2026-10-14T03:00:00Z');
        const repo = createInMemoryTaiwanRepository();
        const request = upstream();
        const load = createTaiwanOnDemand({ repo, request, now: () => now });
        const key = { exchange: 'TWSE' as const, code: '2330' };
        const first = await load.history(key, 800);
        expect(first.status.state).toBe('partial');
        expect(first.status.completed).toBe(2);
        expect(first.bars.at(-1)).toMatchObject({ c: 104, v: 1200001, complete: true });
        await load.history(key, 800);
        expect(request.mock.calls.filter(([url]) => url.includes('STOCK_DAY?'))).toHaveLength(2);
        now = new Date(now.getTime() + 31_000);
        const next = await load.history(key, 800);
        expect(next.status.completed).toBe(4);
        expect(next.bars.length).toBe(4);
    });

    it('still returns fetched official data if database persistence fails', async () => {
        const base = createInMemoryTaiwanRepository();
        const repo = { ...base, readCatalog: async () => { throw new Error('db unavailable'); },
            writeCatalog: async () => { throw new Error('db unavailable'); } };
        const load = createTaiwanOnDemand({ repo, request: upstream() });
        expect((await load.catalog()).some(s => s.code === '2330')).toBe(true);
    });

    it('does not turn an upstream failure into an empty successful catalog', async () => {
        const load = createTaiwanOnDemand({ repo: createInMemoryTaiwanRepository(), request: async () => { throw new Error('offline'); } });
        await expect(load.catalog()).rejects.toThrow();
    });

    it('does not request an unfinished TPEX session and loads the new day after rollover', async () => {
        let now = new Date('2026-10-14T03:00:00Z');
        const request = vi.fn<TaiwanRequester>(async url => ({ stat: 'ok', date: new URL(url).searchParams.get('date')!.replaceAll('/', ''),
            tables: [{ fields: ['代號', '成交股數', '開盤', '最高', '最低', '收盤'], data: [['6488', '1234567', '100', '105', '99', '104']] }] }));
        const load = createTaiwanOnDemand({ repo: createInMemoryTaiwanRepository(), request, now: () => now });
        const key = { exchange: 'TPEX' as const, code: '6488' };
        const first = await load.history(key, 800);
        expect(first.bars.at(-1)?.tradingDate).toBe('2026-10-13');
        expect(first.status.completedPeriods).not.toContain('2026-10-14');
        now = new Date('2026-10-15T03:00:00Z');
        const next = await load.history(key, 800);
        expect(next.bars.at(-1)?.tradingDate).toBe('2026-10-14');
        expect(next.status.completedPeriods).toContain('2026-10-14');
        expect(next.bars.at(-1)?.v).toBe(1234567);
    });

    it('retries a partially loaded market catalog on a new server instance', async () => {
        const repo = createInMemoryTaiwanRepository();
        const base = upstream();
        const first = vi.fn<TaiwanRequester>(async (url, init) => {
            if (url.includes('mopsfin_t187ap03_O')) throw new Error('temporary TPEX outage');
            return base(url, init);
        });
        await createTaiwanOnDemand({ repo, request: first }).catalog();
        const recovered: TaiwanRequester = async (url, init) => url.includes('mopsfin_t187ap03_O')
            ? [{ SecuritiesCompanyCode: '6488', CompanyAbbreviation: '環球晶', ParValueOfCommonStock: '新台幣10元' }]
            : base(url, init);
        const next = await createTaiwanOnDemand({ repo, request: recovered }).catalog();
        expect(next.some(s => s.symbol === 'TPEX:6488')).toBe(true);
        expect(next.some(s => s.symbol === 'TWSE:2330')).toBe(true);
    });

    it('refreshes recent prices without redownloading completed older periods', async () => {
        let now = new Date('2026-10-14T03:00:00Z');
        const request = upstream();
        const load = createTaiwanOnDemand({ repo: createInMemoryTaiwanRepository(), request, now: () => now });
        const key = { exchange: 'TWSE' as const, code: '2330' };
        let current = await load.history(key, 800);
        for (let i = 0; current.status.state !== 'ready' && i < 20; i++) {
            now = new Date(now.getTime() + 31_000);
            current = await load.history(key, 800);
        }
        expect(current.status.state).toBe('ready');
        const before = request.mock.calls.length;
        now = new Date(now.getTime() + 3600_001);
        const refreshed = await load.history(key, 800);
        expect(refreshed.status.state).toBe('ready');
        expect(request.mock.calls.length - before).toBe(1);
    });
});
