import { getDailyCandlesWithReason } from '@/lib/actions/alpaca.actions';
import { getFactorPreference } from '@/lib/actions/factor-preferences.actions';
import { CandleRequestError } from '@/lib/candles/shared';
import { candleMarket } from '@/lib/candles/symbols';
import { defaultFactorPreference, marketForSymbol } from '@/lib/indicators/factor-periods';
import type { RawCandles } from '@/lib/candles/types';
import type { Candle } from '@/lib/indicators/types';
import { createResearchSnapshot } from './snapshot';

export function canonicalResearchSymbol(value: string): string | null {
    if (typeof value !== 'string' || value.length > 80) return null;
    const market = candleMarket(value);
    if (market.kind === 'us') return market.symbol;
    if (market.kind === 'binance') return `BINANCE:${market.symbol}`;
    if (market.kind === 'coingecko') return `CG:${market.symbol}`;
    if (market.kind === 'taiwan' && market.exchange) return `${market.exchange}:${market.symbol}`;
    return null;
}
function candles(raw: RawCandles): Candle[] {
    if (![raw.t, raw.o, raw.h, raw.l, raw.v].every(a => Array.isArray(a) && a.length === raw.c.length)) throw new Error('Candle array mismatch');
    return raw.c.map((c, i) => ({ t: raw.t[i], o: raw.o[i], h: raw.h[i], l: raw.l[i], c, v: raw.v[i] }));
}
export async function loadResearchSnapshot(symbol: string) {
    const market = marketForSymbol(symbol);
    if (!market) throw new CandleRequestError('unsupported-symbol');
    const now = new Date();
    const [primary, benchmark, settings] = await Promise.all([
        getDailyCandlesWithReason(symbol, 800),
        market === 'us' ? getDailyCandlesWithReason('SPY', 400).catch(() => null) : Promise.resolve(null),
        getFactorPreference(symbol),
    ]);
    if (!primary.candles || !primary.source) throw new CandleRequestError(primary.reason ?? 'no-data');
    const contextWarnings = settings?.readError ? ['個人因素偏好讀取失敗，本報告使用標準週期。'] : [];
    return createResearchSnapshot({ symbol, source: primary.source, candles: candles(primary.candles),
        benchmark: benchmark?.candles ? candles(benchmark.candles) : null,
        preference: settings?.preference ?? defaultFactorPreference(market), volumeComplete: primary.candles.volumeComplete,
        now, sourceCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA, contextWarnings });
}
