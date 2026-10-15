import { it, expect } from 'vitest';
import { buildHistoricalRows } from './history-dataset';
import { createResearchSnapshot } from './snapshot';
import { defaultFactorPreference } from '@/lib/indicators/factor-periods';
const candles = Array.from({ length: 350 }, (_, i) => ({ t: Date.parse('2025-01-01T00:00:00Z') / 1000 + i * 86400, o: 100+i, h: 104+i, l: 99+i, c: 103+i, v: 1000 }));
const base = { symbol: 'BINANCE:BTCUSDT', source: { provider: 'binance' as const, symbol: 'BTCUSDT', timeZone: 'UTC' }, candles, sessionDates: candles.map(c=>new Date(c.t*1000).toISOString().slice(0,10)), labelPolicy: 'crypto-close-positive-v1' as const };
it('pins past-only shared engine inputs and excludes immature horizon tails', () => {
    const rows = buildHistoricalRows(base); expect(rows).toHaveLength(21);
    expect(rows[0].label).toBe(1); expect(rows[0].labelEnd).toBe(base.sessionDates[329]);
    const expected = createResearchSnapshot({ symbol: base.symbol, source: base.source, candles: candles.slice(0,300), preference: defaultFactorPreference('crypto'), now: new Date(candles[299].t*1000+86400000) });
    expect(rows[0].snapshot.indicators).toEqual(expected.indicators);
});
it('rejects missing crypto days and unadjusted stock labels', () => {
    expect(()=>buildHistoricalRows({...base,candles: candles.filter((_,i)=>i!==301)})).toThrow();
    expect(()=>buildHistoricalRows({...base,symbol:'AAPL',source:{...base.source,provider:'alpaca',timeZone:'America/New_York'},labelPolicy:'stock-adjusted-positive-v1'})).toThrow('adjusted');
});
it('never silently shifts a stock target over a missing market session', () => {
    const stock={...base,symbol:'AAPL',source:{...base.source,provider:'alpaca' as const,timeZone:'America/New_York'},labelPolicy:'stock-adjusted-positive-v1' as const,adjustedClose:candles.map(c=>c.c),adjustmentSource:'fixture-splits-dividends'};
    expect(()=>buildHistoricalRows({...stock,sessionDates:[...stock.sessionDates.slice(0,300),'2025-10-27',...stock.sessionDates.slice(300)]})).toThrow();
});
