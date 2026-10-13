import { describe, expect, it, vi } from 'vitest';
import twse0050Fixture from '../../__tests__/fixtures/taiwan/twse-0050-202609.json';
import tpexDailyFixture from '../../__tests__/fixtures/taiwan/tpex-daily-20260901.json';
import twseMixedFixture from '../../__tests__/fixtures/taiwan/twse-mixed-invalid.json';
import twseCrossMonthFixture from '../../__tests__/fixtures/taiwan/twse-cross-month.json';
import twseEmptyFixture from '../../__tests__/fixtures/taiwan/twse-empty.json';
import tpexEmptyFixture from '../../__tests__/fixtures/taiwan/tpex-empty.json';
import twseStockMismatchFixture from '../../__tests__/fixtures/taiwan/twse-stock-mismatch.json';
import tpexDateMismatchFixture from '../../__tests__/fixtures/taiwan/tpex-date-mismatch.json';
import twseAllMalformedFixture from '../../__tests__/fixtures/taiwan/twse-all-malformed.json';
import { fetchTaiwanDataset, fetchTaiwanHistory } from './sources';
import { TaiwanSourceError } from './types';

describe('fetchTaiwanHistory - TWSE', () => {
    it('fetches 0050 monthly daily bars tolerating extra annotation columns in fields', async () => {
        const requester = vi.fn().mockResolvedValue(twse0050Fixture);

        const bars = await fetchTaiwanHistory({ exchange: 'TWSE', code: '0050' }, '2026-09', requester);

        expect(requester).toHaveBeenCalledTimes(1);
        expect(requester).toHaveBeenCalledWith(
            'https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20260901&stockNo=0050'
        );

        expect(bars).toHaveLength(2);
        const [first, second] = bars;

        expect(first).toMatchObject({
            exchange: 'TWSE',
            code: '0050',
            tradingDate: '2026-09-01',
            o: 185.0,
            h: 187.5,
            l: 184.2,
            c: 186.8,
            v: 15234567,
            change: 1.8,
            complete: true,
            source: 'twse',
            priceBasis: 'unadjusted',
        });
        expect(first.t).toBe(Date.parse('2026-09-01T00:00:00+08:00'));
        expect(typeof first.fetchedAt).toBe('string');

        expect(second.tradingDate).toBe('2026-09-02');
        expect(second.v).toBe(12450123);
    });
});

describe('fetchTaiwanHistory - TPEX', () => {
    it('fetches daily quotes, parses all rows, and verifies exact shares volume for 6488', async () => {
        const requester = vi.fn().mockResolvedValue(tpexDailyFixture);

        const bars = await fetchTaiwanHistory({ exchange: 'TPEX', code: '6488' }, '2026-09-01', requester);

        expect(requester).toHaveBeenCalledTimes(1);
        expect(requester).toHaveBeenCalledWith(
            'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=2026/09/01&response=json'
        );

        expect(bars).toHaveLength(2);
        const bar6488 = bars.find(b => b.code === '6488');
        expect(bar6488).toBeDefined();
        expect(bar6488?.v).toBe(13645310);
        // Assert exact shares volume is NOT the month contract count 12,770,000
        expect(bar6488?.v).not.toBe(12770000);
        expect(bar6488).toMatchObject({
            exchange: 'TPEX',
            code: '6488',
            tradingDate: '2026-09-01',
            o: 446.0,
            h: 452.0,
            l: 445.0,
            c: 450.0,
            change: 5.0,
            complete: true,
            source: 'tpex',
            priceBasis: 'unadjusted',
        });

        const bar00679B = bars.find(b => b.code === '00679B');
        expect(bar00679B?.v).toBe(20826466);
    });
});

describe('fetchTaiwanHistory - Edge Cases & Errors', () => {
    it('throws TaiwanSourceError on HTTP 403 or 429', async () => {
        const requester403 = vi.fn().mockRejectedValue(new Error('HTTP 403 Forbidden'));
        await expect(fetchTaiwanHistory({ exchange: 'TWSE', code: '2330' }, '2026-09', requester403))
            .rejects.toThrow(TaiwanSourceError);

        const requester429 = vi.fn().mockRejectedValue(new Error('HTTP 429 Too Many Requests'));
        await expect(fetchTaiwanHistory({ exchange: 'TPEX', code: '6488' }, '2026-09-01', requester429))
            .rejects.toThrow(TaiwanSourceError);
    });

    it('throws TaiwanSourceError when receiving HTML 200 instead of JSON', async () => {
        const requesterHtml = vi.fn().mockResolvedValue('<!DOCTYPE html><html><body>Blocked</body></html>');
        await expect(fetchTaiwanHistory({ exchange: 'TWSE', code: '0050' }, '2026-09', requesterHtml))
            .rejects.toThrow(TaiwanSourceError);
    });

    it('returns empty array on valid empty data responses', async () => {
        const twseEmptyRequester = vi.fn().mockResolvedValue(twseEmptyFixture);
        const twseBars = await fetchTaiwanHistory({ exchange: 'TWSE', code: '0050' }, '2026-09', twseEmptyRequester);
        expect(twseBars).toEqual([]);

        const tpexEmptyRequester = vi.fn().mockResolvedValue(tpexEmptyFixture);
        const tpexBars = await fetchTaiwanHistory({ exchange: 'TPEX', code: '6488' }, '2026-09-01', tpexEmptyRequester);
        expect(tpexBars).toEqual([]);
    });

    it('filters out invalid rows from mixed responses without rejecting valid ones', async () => {
        const requester = vi.fn().mockResolvedValue(twseMixedFixture);
        const bars = await fetchTaiwanHistory({ exchange: 'TWSE', code: '0050' }, '2026-09', requester);

        expect(bars).toHaveLength(2);
        expect(bars[0].tradingDate).toBe('2026-09-01');
        expect(bars[1].tradingDate).toBe('2026-09-05');
    });

    it('throws TaiwanSourceError when all rows are malformed', async () => {
        const requester = vi.fn().mockResolvedValue(twseAllMalformedFixture);
        await expect(fetchTaiwanHistory({ exchange: 'TWSE', code: '0050' }, '2026-09', requester))
            .rejects.toThrow(TaiwanSourceError);
    });

    it('filters out cross-month rows for TWSE monthly history', async () => {
        const requester = vi.fn().mockResolvedValue(twseCrossMonthFixture);
        const bars = await fetchTaiwanHistory({ exchange: 'TWSE', code: '0050' }, '2026-09', requester);

        expect(bars).toHaveLength(1);
        expect(bars[0].tradingDate).toBe('2026-09-30');
    });

    it('throws TaiwanSourceError when TWSE response stock code does not match request', async () => {
        const requester = vi.fn().mockResolvedValue(twseStockMismatchFixture);
        await expect(fetchTaiwanHistory({ exchange: 'TWSE', code: '0050' }, '2026-09', requester))
            .rejects.toThrow(TaiwanSourceError);
    });

    it('throws TaiwanSourceError when TPEX response date does not match request', async () => {
        const requester = vi.fn().mockResolvedValue(tpexDateMismatchFixture);
        await expect(fetchTaiwanHistory({ exchange: 'TPEX', code: '6488' }, '2026-09-01', requester))
            .rejects.toThrow(TaiwanSourceError);
    });
});

describe('fetchTaiwanDataset', () => {
    it('fetches registered TWSE dataset using GET', async () => {
        const requester = vi.fn().mockResolvedValue([{ Code: '2330', Name: '台積電' }]);
        const data = await fetchTaiwanDataset('twse-stock-day-all', requester);

        expect(requester).toHaveBeenCalledWith(
            'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
            undefined
        );
        expect(data).toEqual([{ Code: '2330', Name: '台積電' }]);
    });

    it('fetches registered TPEX dataset with POST method when configured', async () => {
        const requester = vi.fn().mockResolvedValue({ data: [] });
        await fetchTaiwanDataset('tpex-etfs', requester);

        expect(requester).toHaveBeenCalledWith(
            'https://info.tpex.org.tw/api/etfFilter',
            { method: 'POST' }
        );
    });

    it('throws TaiwanSourceError on HTML response or unknown dataset id', async () => {
        const htmlRequester = vi.fn().mockResolvedValue('<html>502 Bad Gateway</html>');
        await expect(fetchTaiwanDataset('twse-stock-day-all', htmlRequester))
            .rejects.toThrow(TaiwanSourceError);

        const dummyRequester = vi.fn();
        await expect(fetchTaiwanDataset('non-existent-dataset' as unknown as import('./datasets').TaiwanDatasetId, dummyRequester))
            .rejects.toThrow(TaiwanSourceError);
    });
});
