import { createResearchSnapshot } from './snapshot';
import { marketForSymbol, defaultFactorPreference } from '@/lib/indicators/factor-periods';
import type { Candle } from '@/lib/indicators/types';
import type { CandleSource } from '@/lib/candles/types';
export interface HistoryBundle {
    symbol: string; source: CandleSource; candles: Candle[]; sessionDates: string[];
    adjustedClose?: number[]; adjustmentSource?: string;
    labelPolicy: 'stock-adjusted-positive-v1' | 'crypto-close-positive-v1'; sourceCommit?: string;
}
export function buildHistoricalRows(input: HistoryBundle) {
    const market = marketForSymbol(input.symbol);
    if (!market || !Array.isArray(input.candles) || input.candles.length > 10000) throw new Error('Invalid historical bundle');
    const crypto = market === 'crypto';
    let previous = -Infinity;
    for (const c of input.candles) {
        if (![c.t,c.o,c.h,c.l,c.c,c.v].every(Number.isFinite) || c.t<=previous || c.t<=0 || c.v<0 || Math.min(c.o,c.h,c.l,c.c)<=0 || c.h<Math.max(c.o,c.l,c.c) || c.l>Math.min(c.o,c.h,c.c)) throw new Error('Invalid historical candle');
        previous=c.t;
    }
    if (input.labelPolicy !== (crypto ? 'crypto-close-positive-v1' : 'stock-adjusted-positive-v1')) throw new Error('Invalid label policy');
    if (!crypto && (!input.adjustmentSource || input.adjustedClose?.length !== input.candles.length || input.adjustedClose.some(p=>!Number.isFinite(p)||p<=0))) throw new Error('Missing adjusted stock closes/source');
    const date = (t:number) => new Intl.DateTimeFormat('en-CA',{timeZone:crypto?'UTC':input.source.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t*1000));
    const dates = input.candles.map(c=>date(c.t));
    if (dates.length !== input.sessionDates.length || dates.some((d,i)=>d!==input.sessionDates[i] || (i>0 && d<=dates[i-1]))) throw new Error('Missing or duplicate calendar session');
    if (crypto && dates.some((d,i)=>i>0 && Date.parse(d)-Date.parse(dates[i-1])!==86400000)) throw new Error('Missing crypto calendar day');
    const horizon = crypto ? 30 : 20;
    const prices = crypto ? input.candles.map(c=>c.c) : input.adjustedClose!;
    const rows = [];
    for (let i=299;i+horizon<input.candles.length;i++) {
        const last = input.candles[i];
        const history = input.candles.slice(0,i+1).filter(c=>c.t>=last.t-800*86400);
        const snapshot = createResearchSnapshot({symbol:input.symbol,source:input.source,candles:history,preference:defaultFactorPreference(market),now:new Date((last.t+86400)*1000),sourceCommit:input.sourceCommit});
        if (snapshot.dataDate !== dates[i]) throw new Error('Historical cutoff mismatch');
        rows.push({snapshot,label:prices[i+horizon]>prices[i]?1:0,labelEnd:dates[i+horizon],labelPolicy:input.labelPolicy,adjustmentSource:input.adjustmentSource??'crypto-close',horizon,horizonUnit:crypto?'calendar_day':'trading_day'});
    }
    return rows;
}
