import { describe, expect, it, vi } from 'vitest';
import { planTaiwanHistory, requestTaiwanHistory, syncTaiwanHistory } from './history';
import { createInMemoryTaiwanRepository } from './repository';
import { TaiwanSourceError, type TaiwanKey, type TaiwanRequester } from './types';
import tpexDailyFixture from '../../__tests__/fixtures/taiwan/tpex-daily-20260901.json';
import twse0050Fixture from '../../__tests__/fixtures/taiwan/twse-0050-202609.json';

describe('planTaiwanHistory', () => {
    const fixedNow = new Date('2026-10-14T10:00:00+08:00');

    it('TWSE 月工作去重且由近至遠排序', () => {
        const key: TaiwanKey = { exchange: 'TWSE', code: '2330' };
        const units = planTaiwanHistory(key, 90, fixedNow);

        expect(units.length).toBeGreaterThan(0);
        // All units must be for TWSE and the given key
        expect(units.every(u => u.exchange === 'TWSE' && u.keys[0].code === '2330')).toBe(true);

        // Deduped months: all periods are unique YYYY-MM
        const periods = units.map(u => u.period);
        const uniquePeriods = Array.from(new Set(periods));
        expect(periods).toEqual(uniquePeriods);

        // Ordered from newest (closest) to oldest
        for (let i = 0; i < periods.length - 1; i++) {
            expect(periods[i].localeCompare(periods[i + 1])).toBeGreaterThan(0);
        }
        // First unit should be current month: 2026-10
        expect(periods[0]).toBe('2026-10');
    });

    it('400 與 800 切片依需求產出不同長度之工作序列', () => {
        const key: TaiwanKey = { exchange: 'TWSE', code: '0050' };
        const units400 = planTaiwanHistory(key, 400, fixedNow);
        const units800 = planTaiwanHistory(key, 800, fixedNow);

        expect(units400.length).toBeGreaterThan(0);
        expect(units800.length).toBeGreaterThan(units400.length);

        // 400 is a prefix slice of 800 (since both start from newest)
        const periods400 = units400.map(u => u.period);
        const periods800 = units800.map(u => u.period);
        expect(periods800.slice(0, periods400.length)).toEqual(periods400);
    });

    it('TPEX 依交易日規劃且排除週末，由近至遠排序', () => {
        const key: TaiwanKey = { exchange: 'TPEX', code: '6488' };
        // 2026-10-14 is Wednesday
        const units = planTaiwanHistory(key, 10, fixedNow);

        expect(units.length).toBeGreaterThan(0);
        expect(units.every(u => u.exchange === 'TPEX')).toBe(true);

        // None of the periods should fall on a Saturday or Sunday
        for (const u of units) {
            const [y, m, d] = u.period.split('-').map(Number);
            const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
            expect([0, 6]).not.toContain(dayOfWeek);
        }

        // Ordered from newest to oldest
        const periods = units.map(u => u.period);
        for (let i = 0; i < periods.length - 1; i++) {
            expect(periods[i].localeCompare(periods[i + 1])).toBeGreaterThan(0);
        }
    });

    it('參數邊界值自動修正：小於 1 或非正數預設為 800，上限 1000', () => {
        const key: TaiwanKey = { exchange: 'TWSE', code: '2330' };
        const unitsDefault = planTaiwanHistory(key, 0, fixedNow);
        const units800 = planTaiwanHistory(key, 800, fixedNow);
        expect(unitsDefault.length).toBe(units800.length);

        const unitsOver = planTaiwanHistory(key, 2000, fixedNow);
        const units1000 = planTaiwanHistory(key, 1000, fixedNow);
        expect(unitsOver.length).toBe(units1000.length);
    });
});

describe('syncTaiwanHistory', () => {
    const fixedNow = new Date('2026-09-02T16:00:00+08:00');

    it('不同 TPEX 商品同一天只送出一次 request 並批次寫入所有追蹤商品', async () => {
        const repo = createInMemoryTaiwanRepository();
        const request = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('dailyQuotes') && url.includes('2026/09/01')) {
                return tpexDailyFixture;
            }
            return { stat: 'ok', tables: [] };
        }) as TaiwanRequester;

        const keys: TaiwanKey[] = [
            { exchange: 'TPEX', code: '6488' },
            { exchange: 'TPEX', code: '00679B' },
        ];

        // Sync 1 day of history (2026-09-01)
        const summary = await syncTaiwanHistory({
            repo,
            request,
            keys,
            days: 2,
            now: fixedNow,
        });

        // Verify only 1 request was made for 2026-09-01 even though 2 TPEX keys were tracked!
        const dailyCalls = (request as ReturnType<typeof vi.fn>).mock.calls.filter(
            call => typeof call[0] === 'string' && call[0].includes('dailyQuotes?date=2026/09/01')
        );
        expect(dailyCalls).toHaveLength(1);

        // Verify bars for both 6488 and 00679B were written to repository
        const bars6488 = await repo.readBars({ exchange: 'TPEX', code: '6488' });
        const bars00679B = await repo.readBars({ exchange: 'TPEX', code: '00679B' });

        expect(bars6488.length).toBe(1);
        expect(bars6488[0].c).toBe(450.0);
        expect(bars00679B.length).toBe(1);
        expect(bars00679B[0].c).toBe(31.25);

        expect(summary.written).toBeGreaterThanOrEqual(2);
        expect(summary.failures).toHaveLength(0);
    });

    it('TWSE 月工作去重並依照由近至遠執行', async () => {
        const repo = createInMemoryTaiwanRepository();
        const requestOrder: string[] = [];
        const request = vi.fn().mockImplementation(async (url: string) => {
            requestOrder.push(url);
            if (url.includes('20260901')) {
                return twse0050Fixture;
            }
            return { stat: 'OK', data: [], fields: ['日期', '成交股數', '成交金額', '開盤價', '最高價', '最低價', '收盤價', '漲跌價差', '成交筆數'] };
        }) as TaiwanRequester;

        const summary = await syncTaiwanHistory({
            repo,
            request,
            keys: [{ exchange: 'TWSE', code: '0050' }],
            days: 60,
            now: fixedNow,
        });

        // Must have called 20260901 first, then 20260801, then 20260701 (from newest to oldest)
        expect(requestOrder.length).toBe(3);
        expect(requestOrder[0]).toContain('date=20260901');
        expect(requestOrder[1]).toContain('date=20260801');
        expect(requestOrder[2]).toContain('date=20260701');

        const bars = await repo.readBars({ exchange: 'TWSE', code: '0050' });
        expect(bars.length).toBe(2);
        expect(summary.written).toBe(2);
    });

    it('failed 月／日不標完成，且 API 失敗保留已成功寫入之資料', async () => {
        const repo = createInMemoryTaiwanRepository();
        const request = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('date=20260901')) {
                return twse0050Fixture; // Success on 1st month
            }
            // Fail on 2nd month
            throw new TaiwanSourceError('api-error', 'TWSE 500 Internal Error', 500);
        }) as TaiwanRequester;

        const summary = await syncTaiwanHistory({
            repo,
            request,
            keys: [{ exchange: 'TWSE', code: '0050' }],
            days: 60,
            now: fixedNow,
        });

        // Successfully written data from 1st month must remain in repo!
        const bars = await repo.readBars({ exchange: 'TWSE', code: '0050' });
        expect(bars.length).toBe(2);

        // Failure must be recorded
        expect(summary.failures.length).toBeGreaterThan(0);
        expect(summary.failures[0]).toContain('TWSE 500');

        // Status for 0050 must NOT be marked ready; must reflect partial/incomplete progress
        const status = await repo.readHistoryStatus({ exchange: 'TWSE', code: '0050' });
        expect(status.state).toBe('partial');
        expect(status.completed).toBeLessThan(status.total);
        expect(status.candleCount).toBe(2);
        expect(status.reason).toBe('api-error');
    });

    it('預算不足時立即中止並回傳 partial 與 budget-limit', async () => {
        const repo = createInMemoryTaiwanRepository();
        const request = vi.fn().mockImplementation(async () => {
            throw new TaiwanSourceError('budget-limit', 'Daily request quota exceeded');
        }) as TaiwanRequester;

        const summary = await syncTaiwanHistory({
            repo,
            request,
            keys: [{ exchange: 'TWSE', code: '2330' }],
            days: 30,
            now: fixedNow,
        });

        expect(summary.failures).toContain('budget-limit');
        const status = await repo.readHistoryStatus({ exchange: 'TWSE', code: '2330' });
        expect(status.state).toBe('partial');
        expect(status.reason).toBe('budget-limit');
    });

    it('停牌或週末等有效 no-data 不捏造 bar', async () => {
        const repo = createInMemoryTaiwanRepository();
        const request = vi.fn().mockImplementation(async () => {
            return {
                stat: '很抱歉，沒有符合條件的資料!',
                data: [],
            };
        }) as TaiwanRequester;

        const summary = await syncTaiwanHistory({
            repo,
            request,
            keys: [{ exchange: 'TWSE', code: '2330' }],
            days: 30,
            now: fixedNow,
        });

        expect(summary.written).toBe(0);
        const bars = await repo.readBars({ exchange: 'TWSE', code: '2330' });
        expect(bars).toHaveLength(0);
    });
});

describe('requestTaiwanHistory', () => {
    it('若歷史功能未啟用（TAIWAN_HISTORY_ENABLED!=true）回傳 disabled', async () => {
        const original = process.env.TAIWAN_HISTORY_ENABLED;
        try {
            process.env.TAIWAN_HISTORY_ENABLED = 'false';
            const status = await requestTaiwanHistory({ exchange: 'TWSE', code: '2330' }, 800);
            expect(status.state).toBe('disabled');
        } finally {
            process.env.TAIWAN_HISTORY_ENABLED = original;
        }
    });

    it('若已有進行中（running/queued）任務，進行去重不重複觸發', async () => {
        const originalEnv = { ...process.env };
        try {
            process.env.TAIWAN_HISTORY_ENABLED = 'true';
            process.env.TAIWAN_AUTO_SYNC_ENABLED = 'true';
            process.env.TAIWAN_MAX_REQUESTS_PER_DAY = '100';
            process.env.TAIWAN_MAX_JOBS_PER_DAY = '10';
            process.env.TAIWAN_MAX_TRANSFER_BYTES_PER_DAY = '50000000';
            process.env.TAIWAN_MAX_STORAGE_BYTES = '100000000';
            process.env.TAIWAN_MAX_TRACKED_SECURITIES = '50';
            process.env.TAIWAN_MAX_RESPONSE_BYTES = '10000000';

            const repo = createInMemoryTaiwanRepository();
            await repo.writeHistoryStatus({ exchange: 'TWSE', code: '2330' }, {
                state: 'running',
                completed: 2,
                total: 10,
                candleCount: 40,
                reason: null,
            });

            // Calling requestTaiwanHistory with repo injected or reading existing status
            const status = await requestTaiwanHistory({ exchange: 'TWSE', code: '2330' }, 800, repo);
            expect(status.state).toBe('running');
            expect(status.completed).toBe(2);
        } finally {
            process.env = originalEnv;
        }
    });
});
