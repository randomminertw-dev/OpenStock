import { createHash } from 'node:crypto';
import { computeAll } from '@/lib/indicators';
import { computeFactors } from '@/lib/indicators/factors';
import { computeIDS, computeIDSFactor, computeIDSPeriod } from '@/lib/indicators/ids';
import { computeVariants } from '@/lib/indicators/variants';
import { marketForSymbol, parseFactorPreference, presetFactorPreference } from '@/lib/indicators/factor-periods';
import type { Candle } from '@/lib/indicators/types';
import type { ResearchSnapshot, SnapshotInput, ObservationId } from './types';

const DAY = 86400_000;
export const RESEARCH_ENGINE_VERSION = 'research-snapshot-v1';
function localDate(t: number, zone: string) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}
/** Pin all inputs to a finished daily session; never include an active daily candle. */
function closed(candles: Candle[], zone: string, crypto: boolean, now: Date): Candle[] {
    const today = localDate(now.getTime(), zone);
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(now));
    let previous = -Infinity;
    let previousDate = '';
    if (candles.length > 1000) throw new Error('Daily snapshot exceeds supported history');
    for (const c of candles) {
        if (![c.t, c.o, c.h, c.l, c.c, c.v].every(Number.isFinite) || c.t <= previous || c.t <= 0
            || Math.min(c.o, c.h, c.l, c.c) <= 0 || c.v < 0 || c.h < Math.max(c.o, c.c, c.l) || c.l > Math.min(c.o, c.c)) {
            throw new Error('Invalid daily candle snapshot');
        }
        const date = localDate(c.t * 1000, zone);
        if (date === previousDate) throw new Error('Duplicate daily session');
        previousDate = date;
        previous = c.t;
    }
    return candles.filter(c => {
        const day = localDate(c.t * 1000, zone);
        return day < today || (!crypto && day === today && hour >= 18);
    });
}
export function createResearchSnapshot(input: SnapshotInput): ResearchSnapshot {
    const market = marketForSymbol(input.symbol);
    if (!market) throw new Error('Unsupported research market');
    const preference = parseFactorPreference(market, input.preference);
    const zone = market === 'crypto' ? 'UTC' : input.source.timeZone;
    const candles = closed(input.candles, zone, market === 'crypto', input.now);
    if (!candles.length) throw new Error('No completed daily candles');
    const last = candles.at(-1)!;
    const asof = new Date(last.t * 1000).toISOString();
    const daily = candles.filter(c => c.t * 1000 >= last.t * 1000 - 400 * DAY);
    const warnings: string[] = [...(input.contextWarnings ?? [])];
    if (preference.interval && preference.interval !== '1d') warnings.push(`報告固定使用日 K，保留各因素 N；未套用個人 ${preference.interval} 盤中週期。`);
    const dataDate = localDate(last.t * 1000, zone);
    const lag = (Date.parse(localDate(input.now.getTime(), zone)) - Date.parse(dataDate)) / DAY;
    if (lag > (market === 'crypto' ? 2 : 7)) warnings.push(`資料落後：最近完整日 K 為 ${dataDate}，請勿視為當日行情。`);
    let spy: Candle[] | null = null;
    if (market === 'us' && input.benchmark?.length) {
        const byDate = new Map(closed(input.benchmark, zone, false, input.now).map(c => [localDate(c.t * 1000, zone), c]));
        const aligned = daily.map(c => byDate.get(localDate(c.t * 1000, zone)));
        if (aligned.length && aligned.every((c): c is Candle => !!c)) spy = aligned;
    }
    if (market === 'us' && !spy) warnings.push('比較基準日期未完整對齊，相關市場廣度指標維持 N/A。');
    const { results } = computeAll(daily, spy);
    const volumeComplete = input.volumeComplete !== false && candles.some(c => c.v > 0);
    if (!volumeComplete) {
        warnings.push('成交量資料缺失或全為零，量能訊號不參與方向判斷。');
        for (const r of results) if (r.category === 'volume') Object.assign(r, { value: null, signal: null, reason: '成交量資料缺失（N/A）' });
    }
    if (market !== 'us') for (const r of results) if (['rs20', 'beta252', 'rrg'].includes(r.id)) r.reason = '此市場尚未設定比較基準（N/A）';
    const factorFor = (periods: typeof preference.periods) => {
        const factors = computeFactors(candles, periods);
        if (!volumeComplete) factors.V = { ...factors.V, score: null, reason: '成交量資料缺失（N/A）' };
        return factors;
    };
    const factors = factorFor(preference.periods);
    const idsPeriod: ResearchSnapshot['idsPeriod'] = {};
    for (const id of ['RSI', 'ADX_DMI', 'CMF', 'ATR'] as const) {
        const variants = computeVariants(daily, id);
        if (id === 'CMF' && !volumeComplete) for (const v of variants) Object.assign(v, { value: null, signal: null });
        const result = computeIDSPeriod(variants);
        idsPeriod[id] = { ...result, nullReason: result.idsPct !== null ? null : !result.validCount ? 'insufficient-data' : id === 'ATR' ? 'non-directional' : 'all-neutral' };
    }
    const profiles = (['short', 'medium', 'long'] as ObservationId[]).map((id, i) => {
        const { periods } = presetFactorPreference(market, id, market === 'crypto' ? '1d' : undefined);
        const values = factorFor(periods);
        return { id, label: ['短線技術', '中線技術', '長線技術'][i], periods, factors: values, ids: computeIDSFactor(values) };
    });
    const availableIndicators = results.filter(r => r.signal !== null).length;
    if (availableIndicators < 30 || daily.length < 60) warnings.push('有效指標或日 K 不足，這是資料受限報告，部分觀察無法確認。');
    const sourceCommit = input.sourceCommit ?? 'unavailable';
    const hashInput = { symbol: input.symbol, source: input.source, candles, daily, benchmark: spy, preference, engine: RESEARCH_ENGINE_VERSION, sourceCommit, volumeComplete, warnings };
    return {
        schemaVersion: 1, engineVersion: RESEARCH_ENGINE_VERSION, sourceCommit,
        inputHash: createHash('sha256').update(JSON.stringify(hashInput)).digest('hex'),
        symbol: input.symbol, market, interval: '1d', source: input.source, asof, dataDate,
        generatedAt: input.now.toISOString(), referencePrice: last.c, candleCount: candles.length,
        preference, indicators: results, ids: computeIDS(results), factors, idsFactor: computeIDSFactor(factors), idsPeriod, profiles, warnings,
        quality: { state: warnings.length ? 'limited' : 'complete', availableIndicators, totalIndicators: results.length, volumeComplete },
    };
}
