import React, { type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/actions/finnhub.actions', () => ({
    getCandlesWithReason: vi.fn().mockResolvedValue({ candles: null, reason: 'api-error', source: null }),
    getNews: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/actions/adanos.actions', () => ({ getStockSentimentInsights: vi.fn().mockResolvedValue(null) }));
// Unrelated authenticated header and third-party iframe are outside the indicator flow.
vi.mock('@/components/stocks/StockHeader', () => ({ default: () => null, StockHeaderSkeleton: () => null }));
vi.mock('@/components/TradingViewWidget', () => ({ default: () => null }));

const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
const start = Date.parse('2025-10-01T00:00:00Z');
function rows(count = 270) {
    return Array.from({ length: count }, (_, i) => {
        const t = start + i * 86400_000;
        const c = 100 + i * 0.2 + Math.sin(i) * 3;
        return { t, o: c - 1, h: c + 2, l: c - 2, c, v: 1000 + i * 10 };
    });
}
function marketFetch(count = 270) {
    return vi.fn(async (input: string) => {
        const url = new URL(input);
        const values = rows(count);
        if (url.hostname === 'data-api.binance.vision') return json(values.map(r => [r.t, String(r.o), String(r.h), String(r.l), String(r.c), String(r.v), r.t + 86400_000 - 1]));
        if (url.hostname === 'api.finmindtrade.com') return json({ status: 200, data: values.map(r => ({
            date: new Date(r.t).toISOString().slice(0, 10), stock_id: url.searchParams.get('data_id'),
            open: r.o, max: r.h, min: r.l, close: r.c, Trading_Volume: r.v,
        })) });
        if (url.hostname === 'api.coingecko.com') return json({ id: 'bitcoin', symbol: 'btc' });
        if (url.hostname === 'data.alpaca.markets') {
            const bars = values.map(r => ({ ...r, t: new Date(r.t).toISOString() }));
            return json({ bars: url.pathname.includes('crypto') ? { 'BTC/USD': bars } : bars });
        }
        return json({}, 404);
    });
}

// Resolve server components before static rendering; client hooks run in React's renderer.
async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
    if (Array.isArray(node)) return Promise.all(node.map(resolveServerTree));
    if (!React.isValidElement(node)) return node;
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (typeof element.type === 'function' && element.type.constructor.name === 'AsyncFunction') {
        return resolveServerTree(await (element.type as (props: unknown) => Promise<ReactNode>)(element.props));
    }
    if (element.props.children === undefined) return element;
    return React.cloneElement(element, undefined, await resolveServerTree(element.props.children));
}

beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('React', React);
    vi.stubEnv('ALPACA_API_KEY', 'test-key');
    vi.stubEnv('ALPACA_API_SECRET', 'test-secret');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T02:00:00Z'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('indicator assessments across markets', () => {
    it.each(['all', 'last'] as const)('does not cast volume votes when %s volume data is missing', async (missing) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ status: 200, data: rows().map((r, i) => ({
            date: new Date(r.t).toISOString().slice(0, 10), stock_id: '2330',
            open: r.o, max: r.h, min: r.l, close: r.c,
            Trading_Volume: missing === 'all' || i === 269 ? undefined : r.v,
        })) })));
        const { getIndicatorAssessmentWithReason, getFactorAssessment } = await import('@/lib/actions/indicators.actions');
        const [{ assessment }, factors] = await Promise.all([getIndicatorAssessmentWithReason('2330.TW'), getFactorAssessment('2330.TW')]);
        expect(assessment?.results).toHaveLength(57);
        expect(assessment?.results.filter(r => r.category === 'volume').every(r => r.signal === null && r.value === null)).toBe(true);
        expect(assessment?.results.find(r => r.id === 'rsi14')?.value).not.toBeNull();
        const votes = assessment!.results.filter(r => r.category !== 'volume' && r.signal !== null);
        expect(assessment!.ids.neutralPct).toBeCloseTo(100 * votes.filter(r => r.signal === 0).length / votes.length);
        expect(factors?.factors.V.score).toBeNull();
        expect(factors?.variants.CMF.every(r => r.signal === null && r.value === null)).toBe(true);
        expect(factors?.idsPeriod.CMF.idsPct).toBeNull();
    });

    it.each(['BINANCE:BTCUSDT', '2330.TW', 'CG:bitcoin'])('computes %s without comparing mismatched SPY sessions', async (symbol) => {
        const fetcher = marketFetch();
        vi.stubGlobal('fetch', fetcher);
        const { getIndicatorAssessmentWithReason, getFactorAssessment } = await import('@/lib/actions/indicators.actions');
        const [{ assessment, reason }, factors] = await Promise.all([getIndicatorAssessmentWithReason(symbol), getFactorAssessment(symbol)]);
        expect(reason).toBeNull();
        expect(assessment?.results).toHaveLength(57);
        expect(assessment?.ids.idsPct).not.toBeNull();
        expect(factors?.factors.T.score).not.toBeNull();
        expect(assessment?.results.filter(r => ['rs20', 'beta252', 'rrg'].includes(r.id)).every(r => r.signal === null)).toBe(true);
        expect(fetcher.mock.calls.some(([url]) => url.includes('/SPY/'))).toBe(false);
    });

    it('preserves US benchmark indicators', async () => {
        vi.stubGlobal('fetch', marketFetch());
        const { getIndicatorAssessment } = await import('@/lib/actions/indicators.actions');
        const result = await getIndicatorAssessment('AAPL');
        expect(result?.results.find(r => r.id === 'beta252')?.value).toBeCloseTo(1);
    });

    it.each([59, 60])('handles the %s candle boundary with an accurate count', async (count) => {
        vi.stubGlobal('fetch', marketFetch(count));
        const { getIndicatorAssessmentWithReason } = await import('@/lib/actions/indicators.actions');
        const result = await getIndicatorAssessmentWithReason('2330.TW');
        if (count === 59) expect(result).toMatchObject({ assessment: null, reason: 'insufficient-data', candleCount: 59 });
        else expect(result.assessment?.results).toHaveLength(57);
    });
});

describe('rendered stock details', () => {
    it.each(['BINANCE:BTCUSDT', '2330.TW', 'CG:bitcoin'])('shows voting, factors and IDS for %s', async (symbol) => {
        const fetcher = marketFetch();
        vi.stubGlobal('fetch', fetcher);
        const { default: Page } = await import('@/app/(root)/stocks/[symbol]/page');
        const html = renderToStaticMarkup(await resolveServerTree(await Page({ params: Promise.resolve({ symbol: encodeURIComponent(symbol) }) })));
        expect(html).toContain('技術投票方向');
        expect(html).toContain('四因素評分');
        expect(html).toContain('IDS-Period');
        expect(html).toContain('資料日期');
        if (symbol === '2330.TW') expect(html).toContain('未還原');
        if (symbol.startsWith('BINANCE:')) expect(html).toContain('BTCUSDT');
        // One request for each market's candles across the concurrently rendered panels.
        expect(fetcher.mock.calls.filter(([url]) => url.includes('/klines') || url.includes('TaiwanStockPrice'))).toHaveLength(symbol.startsWith('CG:') ? 0 : 1);
    });

    it('does not label a provider outage as insufficient history', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 429)));
        const { default: Dashboard } = await import('@/components/stocks/IndicatorDashboard');
        const html = renderToStaticMarkup(await resolveServerTree(await Dashboard({ symbol: 'BINANCE:BTCUSDT' })));
        expect(html).toContain('行情服務暫時無法使用');
        expect(html).not.toContain('<h3>資料不足</h3>');
    });
});
