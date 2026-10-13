import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryTaiwanRepository } from './repository';
import { setTaiwanRepositoryForTesting } from './reads';
import { __resetTaiwanCandlesCacheForTests, officialTaiwanCandles } from './candles';
import type { TaiwanBar, TaiwanSecurity } from './types';
import { computeFactors } from '../indicators/factors';
import type { Candle } from '../indicators/types';

const NOW_ISO = '2026-10-13T02:00:00Z'; // 2026-10-13 10:00:00 in Taipei
const NOW_MS = Date.parse(NOW_ISO);

function makeBar(
    exchange: 'TWSE' | 'TPEX',
    code: string,
    tradingDate: string,
    overrides: Partial<TaiwanBar> = {}
): TaiwanBar {
    const t = Date.parse(`${tradingDate}T00:00:00+08:00`);
    return {
        exchange,
        code,
        tradingDate,
        t,
        o: 100,
        h: 105,
        l: 98,
        c: 102,
        v: 1000000,
        change: 2,
        complete: true,
        source: exchange === 'TWSE' ? 'twse' : 'tpex',
        priceBasis: 'unadjusted',
        fetchedAt: new Date(t).toISOString(),
        ...overrides,
    };
}

function makeSeries(
    exchange: 'TWSE' | 'TPEX',
    code: string,
    count: number,
    endDate = '2026-10-12'
): TaiwanBar[] {
    const endMs = Date.parse(`${endDate}T00:00:00+08:00`);
    const bars: TaiwanBar[] = [];
    for (let i = count - 1; i >= 0; i--) {
        const ms = endMs - i * 86400_000;
        const dateStr = new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
        const c = 100 + ((count - 1 - i) % 30);
        bars.push(
            makeBar(exchange, code, dateStr, {
                t: ms,
                o: c - 1,
                h: c + 2,
                l: c - 2,
                c,
                v: 1000000 + i * 100,
            })
        );
    }
    return bars;
}

const SEC_0050: TaiwanSecurity = {
    exchange: 'TWSE',
    code: '0050',
    symbol: 'TWSE:0050',
    name: '元大台灣50',
    kind: 'etf',
    currency: 'TWD',
    listingDate: '2003-06-30',
    status: 'active',
    metadata: {},
    source: 'twse',
    asof: '2026-10-13',
};

const SEC_6488: TaiwanSecurity = {
    exchange: 'TPEX',
    code: '6488',
    symbol: 'TPEX:6488',
    name: '環球晶',
    kind: 'stock',
    currency: 'TWD',
    listingDate: '2015-09-25',
    status: 'active',
    metadata: {},
    source: 'tpex',
    asof: '2026-10-13',
};

describe('officialTaiwanCandles', () => {
    let repo = createInMemoryTaiwanRepository();

    beforeEach(async () => {
        await __resetTaiwanCandlesCacheForTests();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(NOW_MS));
        repo = createInMemoryTaiwanRepository();
        setTaiwanRepositoryForTesting(repo);
    });

    afterEach(async () => {
        setTaiwanRepositoryForTesting(null);
        await __resetTaiwanCandlesCacheForTests();
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it('returns the identical bar sequence for TWSE:0050 and 0050.TW', async () => {
        await repo.writeCatalog([SEC_0050]);
        const bars = makeSeries('TWSE', '0050', 50);
        await repo.writeBars(bars);

        const resultPrefix = await officialTaiwanCandles('TWSE:0050', 400);
        const resultSuffix = await officialTaiwanCandles('0050.TW', 400);
        const resultBare = await officialTaiwanCandles('0050', 400);

        expect(resultPrefix.reason).toBeNull();
        expect(resultPrefix.source).toEqual({
            provider: 'twse',
            symbol: '0050',
            timeZone: 'Asia/Taipei',
            priceBasis: 'unadjusted',
        });
        expect(resultPrefix.candles).toEqual(resultSuffix.candles);
        expect(resultPrefix.candles).toEqual(resultBare.candles);
        expect(resultPrefix.candles!.c).toHaveLength(50);
    });

    it('routes TPEX symbols to TPEX and does not use TWSE', async () => {
        await repo.writeCatalog([SEC_6488]);
        const bars = makeSeries('TPEX', '6488', 30);
        await repo.writeBars(bars);

        const resultPrefix = await officialTaiwanCandles('TPEX:6488', 400);
        const resultSuffix = await officialTaiwanCandles('6488.TWO', 400);
        const resultBare = await officialTaiwanCandles('6488', 400);

        expect(resultPrefix.reason).toBeNull();
        expect(resultPrefix.source).toEqual({
            provider: 'tpex',
            symbol: '6488',
            timeZone: 'Asia/Taipei',
            priceBasis: 'unadjusted',
        });
        expect(resultPrefix.candles).toEqual(resultSuffix.candles);
        expect(resultPrefix.candles).toEqual(resultBare.candles);
        expect(resultPrefix.source?.provider).toBe('tpex');
    });

    it('slices 800 and 400 days by their respective calendar date boundaries', async () => {
        await repo.writeCatalog([SEC_0050]);
        // Write 900 days of bars
        const bars = makeSeries('TWSE', '0050', 900);
        await repo.writeBars(bars);

        const res400 = await officialTaiwanCandles('TWSE:0050', 400);
        const res800 = await officialTaiwanCandles('TWSE:0050', 800);

        expect(res400.reason).toBeNull();
        expect(res800.reason).toBeNull();

        // 400 calendar days slice has fewer bars than 800 calendar days
        expect(res400.candles!.t.length).toBeLessThan(res800.candles!.t.length);
        expect(res400.candles!.t.length).toBeGreaterThan(0);
        expect(res800.candles!.t.length).toBeGreaterThan(400);

        // Earliest timestamp of 400-day slice is after earliest timestamp of 800-day slice
        expect(res400.candles!.t[0]).toBeGreaterThan(res800.candles!.t[0]);
    });

    it('excludes today incomplete or open snapshot bars', async () => {
        await repo.writeCatalog([SEC_0050]);
        const bars = makeSeries('TWSE', '0050', 10, '2026-10-12');
        // Add today's bar with complete: false
        bars.push(makeBar('TWSE', '0050', '2026-10-13', { complete: false, c: 999 }));
        await repo.writeBars(bars);

        const result = await officialTaiwanCandles('TWSE:0050', 400);
        expect(result.reason).toBeNull();
        expect(result.candles!.c).not.toContain(999);
        expect(result.candles!.t).toHaveLength(10);
    });

    it('preserves volume as exact shares with volumeComplete true', async () => {
        await repo.writeCatalog([SEC_0050]);
        const bar = makeBar('TWSE', '0050', '2026-10-12', { v: 12345678 });
        await repo.writeBars([bar]);

        const result = await officialTaiwanCandles('TWSE:0050', 400);
        expect(result.candles!.v).toEqual([12345678]);
        expect(result.candles!.volumeComplete).toBe(true);
    });

    it('skips a malformed bar without discarding the remaining valid sequence', async () => {
        await repo.writeCatalog([SEC_0050]);
        const bars = makeSeries('TWSE', '0050', 15);
        // Corrupt bar at index 5 with invalid close NaN
        bars[5] = { ...bars[5], c: NaN };
        // Corrupt bar at index 8 with negative volume
        bars[8] = { ...bars[8], v: -100 };
        // Corrupt bar at index 10 with non-positive price
        bars[10] = { ...bars[10], o: 0 };
        await repo.writeBars(bars);

        const result = await officialTaiwanCandles('TWSE:0050', 400);
        expect(result.reason).toBeNull();
        // 15 - 3 = 12 valid bars
        expect(result.candles!.t).toHaveLength(12);
        expect(result.candles!.c.every((p) => Number.isFinite(p) && p > 0)).toBe(true);
    });

    it('preserves history status reason on empty data without masking as empty array', async () => {
        await repo.writeCatalog([SEC_0050]);
        await repo.writeHistoryStatus({ exchange: 'TWSE', code: '0050' }, {
            state: 'disabled',
            completed: 0,
            total: 0,
            candleCount: 0,
            reason: 'missing-config',
        });

        const resDisabled = await officialTaiwanCandles('TWSE:0050', 400);
        expect(resDisabled).toMatchObject({
            candles: null,
            reason: 'missing-config',
            source: { provider: 'twse', symbol: '0050' },
        });

        await repo.writeHistoryStatus({ exchange: 'TWSE', code: '0050' }, {
            state: 'error',
            completed: 0,
            total: 0,
            candleCount: 0,
            reason: 'api-error',
        });

        const resError = await officialTaiwanCandles('TWSE:0050', 400);
        expect(resError).toMatchObject({
            candles: null,
            reason: 'api-error',
            source: { provider: 'twse', symbol: '0050' },
        });

        await repo.writeHistoryStatus({ exchange: 'TWSE', code: '0050' }, {
            state: 'ready',
            completed: 10,
            total: 10,
            candleCount: 0,
            reason: null,
        });

        const resNoData = await officialTaiwanCandles('TWSE:0050', 400);
        expect(resNoData).toMatchObject({
            candles: null,
            reason: 'no-data',
            source: { provider: 'twse', symbol: '0050' },
        });
    });

    describe('R factor sample requirements with official daily history', () => {
        function toCandleArray(raw: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }): Candle[] {
            return raw.t.map((t, i) => ({
                t,
                o: raw.o[i],
                h: raw.h[i],
                l: raw.l[i],
                c: raw.c[i],
                v: raw.v[i],
            }));
        }

        it('reports R as N/A at 251 bars for N=126', async () => {
            await repo.writeCatalog([SEC_0050]);
            await repo.writeBars(makeSeries('TWSE', '0050', 251));

            const res = await officialTaiwanCandles('TWSE:0050', 800);
            expect(res.candles!.t).toHaveLength(251);

            const candles = toCandleArray(res.candles!);
            const factors = computeFactors(candles, { T: 42, M: 126, V: 126, R: 126 });
            expect(factors.R.score).toBeNull();
            expect(factors.R.sampleCount).toBe(125);
            expect(factors.R.reason).toContain('資料不足');
        });

        it('computes R at 252 bars with minimum 126 samples for N=126', async () => {
            await repo.writeCatalog([SEC_0050]);
            await repo.writeBars(makeSeries('TWSE', '0050', 252));

            const res = await officialTaiwanCandles('TWSE:0050', 800);
            expect(res.candles!.t).toHaveLength(252);

            const candles = toCandleArray(res.candles!);
            const factors = computeFactors(candles, { T: 42, M: 126, V: 126, R: 126 });
            expect(factors.R.score).not.toBeNull();
            expect(factors.R.sampleCount).toBe(126);
            expect(factors.R.score).toBeGreaterThanOrEqual(0);
            expect(factors.R.score).toBeLessThanOrEqual(100);
        });

        it('computes R at 378 bars with full 252 samples for N=126', async () => {
            await repo.writeCatalog([SEC_0050]);
            await repo.writeBars(makeSeries('TWSE', '0050', 378));

            const res = await officialTaiwanCandles('TWSE:0050', 800);
            expect(res.candles!.t).toHaveLength(378);

            const candles = toCandleArray(res.candles!);
            const factors = computeFactors(candles, { T: 42, M: 126, V: 126, R: 126 });
            expect(factors.R.score).not.toBeNull();
            expect(factors.R.sampleCount).toBe(252);
        });

        it('reports R as N/A for newly listed stock (< 126 bars)', async () => {
            await repo.writeCatalog([SEC_0050]);
            await repo.writeBars(makeSeries('TWSE', '0050', 50));

            const res = await officialTaiwanCandles('TWSE:0050', 800);
            const candles = toCandleArray(res.candles!);
            const factors = computeFactors(candles, { T: 42, M: 126, V: 126, R: 126 });
            expect(factors.R.score).toBeNull();
        });
    });
});
