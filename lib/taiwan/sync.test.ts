import { describe, expect, it, vi } from 'vitest';
import { syncTaiwanClose } from './sync';
import { createInMemoryTaiwanRepository } from './repository';
import { TaiwanSourceError, type TaiwanBar, type TaiwanRequester } from './types';
import twseRevenueFixture from '../../__tests__/fixtures/taiwan/twse-revenue.json';

describe('syncTaiwanClose', () => {
    const fixedNow = new Date('2026-10-14T17:00:00+08:00'); // Wednesday post-market

    it('資料日期舊於今日仍顯示舊日期，不自動捏造今日日期', async () => {
        const repo = createInMemoryTaiwanRepository();
        // Mock upstream returning quotes dated 2026-10-13
        const request = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('STOCK_DAY_ALL')) {
                return [
                    {
                        Code: '2330',
                        Name: '台積電',
                        OpeningPrice: '1000.00',
                        HighestPrice: '1010.00',
                        LowestPrice: '995.00',
                        ClosingPrice: '1005.00',
                        TradeVolume: '25000000',
                        Change: '+10.00',
                        Date: '2026-10-13',
                    },
                ];
            }
            if (url.includes('tpex_mainboard_daily_close_quotes')) {
                return [
                    {
                        Date: '1151013',
                        SecuritiesCompanyCode: '6488',
                        CompanyName: '環球晶',
                        Open: '450.00',
                        High: '455.00',
                        Low: '448.00',
                        Close: '452.00',
                        TradingShares: '12000000',
                        Change: '+2.00',
                    },
                ];
            }
            if (url.includes('holidaySchedule')) {
                return [];
            }
            return [];
        }) as TaiwanRequester;

        const summary = await syncTaiwanClose({
            repo,
            request,
            now: fixedNow,
        });

        expect(summary.written).toBeGreaterThan(0);

        const bars2330 = await repo.readBars({ exchange: 'TWSE', code: '2330' });
        expect(bars2330.length).toBe(1);
        // Preserves actual data date 2026-10-13, NOT 2026-10-14!
        expect(bars2330[0].tradingDate).toBe('2026-10-13');

        const bars6488 = await repo.readBars({ exchange: 'TPEX', code: '6488' });
        expect(bars6488.length).toBe(1);
        expect(bars6488[0].tradingDate).toBe('2026-10-13');
    });

    it('當日僅有 OpenAPI 快照不能標記為完成；歷史確認後才提升完成狀態', async () => {
        const repo = createInMemoryTaiwanRepository();
        const request = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('STOCK_DAY_ALL')) {
                return [
                    {
                        Code: '2330',
                        Name: '台積電',
                        OpeningPrice: '1000.00',
                        HighestPrice: '1010.00',
                        LowestPrice: '995.00',
                        ClosingPrice: '1005.00',
                        TradeVolume: '25000000',
                        Change: '+10.00',
                        Date: '2026-10-14',
                    },
                ];
            }
            if (url.includes('holidaySchedule')) {
                return [];
            }
            return [];
        }) as TaiwanRequester;

        // Step 1: Sync close snapshot via OpenAPI
        await syncTaiwanClose({ repo, request, now: fixedNow });

        const initialBars = await repo.readBars({ exchange: 'TWSE', code: '2330' });
        expect(initialBars.length).toBe(1);
        // OpenAPI snapshot bar must NOT be marked complete
        expect(initialBars[0].complete).toBe(false);

        // Step 2: Confirmation from official history arrives with complete: true
        const confirmedBar: TaiwanBar = {
            ...initialBars[0],
            complete: true,
            fetchedAt: new Date(Date.now() + 1000).toISOString(),
        };
        await repo.writeBars([confirmedBar]);

        const upgradedBars = await repo.readBars({ exchange: 'TWSE', code: '2330' });
        expect(upgradedBars[0].complete).toBe(true);

        // Step 3: A subsequent rerun of OpenAPI close snapshot (complete: false) CANNOT demote complete: true
        await syncTaiwanClose({ repo, request, now: fixedNow });
        const protectedBars = await repo.readBars({ exchange: 'TWSE', code: '2330' });
        expect(protectedBars[0].complete).toBe(true);
    });

    it('每日資料集成功後記錄 checkpoint，不重複全量下載', async () => {
        const repo = createInMemoryTaiwanRepository();
        // Pre-populate checkpoint for twse-revenue as today (2026-10-14)
        await repo.writeDatasetCheckpoint('twse-revenue', '2026-10-14');

        const requestedUrls: string[] = [];
        const request = vi.fn().mockImplementation(async (url: string) => {
            requestedUrls.push(url);
            if (url.includes('t187ap05_L')) { // twse-revenue URL
                return twseRevenueFixture;
            }
            if (url.includes('holidaySchedule')) {
                return [];
            }
            return [];
        }) as TaiwanRequester;

        const summary = await syncTaiwanClose({
            repo,
            request,
            now: fixedNow,
        });

        // twse-revenue should NOT have been fetched because checkpoint was already today
        const revenueCalls = requestedUrls.filter(u => u.includes('t187ap05_L'));
        expect(revenueCalls).toHaveLength(0);
        expect(summary.skipped).toBeGreaterThan(0);
    });

    it('某一資料集失敗不阻止其他已成功結果寫入', async () => {
        const repo = createInMemoryTaiwanRepository();
        const request = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('STOCK_DAY_ALL')) {
                return [
                    {
                        Code: '2330',
                        Name: '台積電',
                        OpeningPrice: '1000.00',
                        HighestPrice: '1010.00',
                        LowestPrice: '995.00',
                        ClosingPrice: '1005.00',
                        TradeVolume: '25000000',
                        Change: '+10.00',
                        Date: '2026-10-14',
                    },
                ];
            }
            if (url.includes('tpex_mainboard_daily_close_quotes')) {
                throw new TaiwanSourceError('api-error', 'TPEX 502 Bad Gateway', 502);
            }
            if (url.includes('holidaySchedule')) {
                return [];
            }
            return [];
        }) as TaiwanRequester;

        const summary = await syncTaiwanClose({
            repo,
            request,
            now: fixedNow,
        });

        // TWSE bar was still written successfully even though TPEX threw 502!
        const bars = await repo.readBars({ exchange: 'TWSE', code: '2330' });
        expect(bars.length).toBe(1);
        expect(summary.written).toBeGreaterThan(0);
        expect(summary.failures.some(f => f.includes('TPEX 502'))).toBe(true);
    });

    it('TWSE holidaySchedule 來源未取得時，標示待確認而不斷定交易日', async () => {
        const repo = createInMemoryTaiwanRepository();
        const request = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('holidaySchedule')) {
                throw new TaiwanSourceError('api-error', 'Holiday schedule unavailable');
            }
            return [];
        }) as TaiwanRequester;

        const summary = await syncTaiwanClose({
            repo,
            request,
            now: fixedNow,
        });

        // Failures should note holiday schedule error or conservative state
        expect(summary.failures.some(f => f.includes('Holiday') || f.includes('holiday'))).toBe(true);
    });

    it('若 close sync lease 已被鎖定，跳過並回報衝突', async () => {
        const repo = createInMemoryTaiwanRepository();
        // Hold lock for 2026-10-14 close sync
        await repo.claimJob('close:sync:2026-10-14', 'other-worker', 60000);

        const request = vi.fn() as unknown as TaiwanRequester;

        const summary = await syncTaiwanClose({
            repo,
            request,
            now: fixedNow,
        });

        expect(summary.failures.some(f => f.includes('Job lease active'))).toBe(true);
        expect(request).not.toHaveBeenCalled();
    });

    it('close sync 執行完畢後必定釋放 lease', async () => {
        const repo = createInMemoryTaiwanRepository();
        const request = vi.fn().mockImplementation(async () => []) as TaiwanRequester;

        await syncTaiwanClose({
            repo,
            request,
            now: fixedNow,
        });

        // Lease must now be freely claimable
        const canClaim = await repo.claimJob('close:sync:2026-10-14', 'new-worker', 1000);
        expect(canClaim).toBe(true);
    });
});
