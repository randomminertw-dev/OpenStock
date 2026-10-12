import { CandleRequestError, createCandleCache, fetchCandleJson, normalizeCandles } from './shared';
import type { CandleResult, CandleSource } from './types';

const cache = createCandleCache();
const DAY = 86400_000;

export async function binanceCandles(pair: string, days: number): Promise<CandleResult> {
    const source: CandleSource = { provider: 'binance', symbol: pair, timeZone: 'UTC' };
    return cache.get(`binance:${pair}:${days}`, source, async () => {
        const now = Date.now();
        const start = Math.floor(now / DAY) * DAY - days * DAY;
        const query = new URLSearchParams({ symbol: pair, interval: '1d', startTime: String(start), endTime: String(now), limit: '1000' });
        const data = await fetchCandleJson(`https://data-api.binance.vision/api/v3/klines?${query}`);
        if (!Array.isArray(data)) throw new CandleRequestError('api-error');
        if (data.some(row => !Array.isArray(row) || row.length < 7 || !Number.isFinite(Number(row[6])))) {
            throw new CandleRequestError('api-error');
        }
        return normalizeCandles(data.filter(row => Number(row[6]) < now).map(row => ({
            t: Number(row[0]) / 1000, o: row[1], h: row[2], l: row[3], c: row[4], v: row[5],
        })));
    });
}

type TaiwanRow = {
    date?: string; stock_id?: string; open?: unknown; max?: unknown;
    min?: unknown; close?: unknown; Trading_Volume?: unknown;
};

export async function taiwanCandles(stockId: string, days: number): Promise<CandleResult> {
    const source: CandleSource = { provider: 'finmind', symbol: stockId, timeZone: 'Asia/Taipei', priceBasis: 'unadjusted' };
    return cache.get(`finmind:${stockId}:${days}`, source, async () => {
        // Date boundaries in Taipei, not the server's local timezone.
        const taipeiNow = Date.now() + 8 * 3600_000;
        const query = new URLSearchParams({
            dataset: 'TaiwanStockPrice', data_id: stockId,
            start_date: new Date(taipeiNow - days * DAY).toISOString().slice(0, 10),
            end_date: new Date(taipeiNow).toISOString().slice(0, 10),
        });
        const token = process.env.FINMIND_API_TOKEN?.trim();
        const data = await fetchCandleJson(`https://api.finmindtrade.com/api/v4/data?${query}`,
            token ? { Authorization: `Bearer ${token}` } : {}) as { status?: number; data?: TaiwanRow[] } | null;
        if (data?.status === 401 || data?.status === 403) throw new CandleRequestError('missing-config');
        if (data?.status !== 200 || !Array.isArray(data.data)) throw new CandleRequestError('api-error');
        return normalizeCandles(data.data.map(row => {
            const date = row?.date ?? '';
            const t = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00+08:00`) : NaN;
            const correctDate = Number.isFinite(t) && new Date(t + 8 * 3600_000).toISOString().slice(0, 10) === date;
            return {
                t: correctDate && row?.stock_id === stockId ? t / 1000 : NaN,
                o: row?.open, h: row?.max, l: row?.min, c: row?.close, v: row?.Trading_Volume,
            };
        }));
    });
}
