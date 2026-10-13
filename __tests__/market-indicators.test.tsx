import React, { type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/actions/finnhub.actions', () => ({
    getCandlesWithReason: vi.fn().mockResolvedValue({ candles: null, reason: 'api-error', source: null }),
    getNews: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/actions/adanos.actions', () => ({ getStockSentimentInsights: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/actions/factor-preferences.actions', () => ({
    getFactorPreference: vi.fn(async (symbol: string) => {
        const { defaultFactorPreference, marketForSymbol } = await import('@/lib/indicators/factor-periods');
        const market = marketForSymbol(symbol);
        return market ? { preference: defaultFactorPreference(market), readError: false } : null;
    }),
    saveFactorPreference: vi.fn(),
}));
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

    it('keeps 57 votes gated at 60 bars while returning independently calculable factors at 59', async () => {
        vi.stubGlobal('fetch', marketFetch(59));
        const { getIndicatorAssessmentWithReason, getFourFactorAssessmentWithReason, getPeriodAssessment } = await import('@/lib/actions/indicators.actions');
        const preference = { market: 'taiwan', preset: 'short', periods: { T: 7, M: 7, V: 7, R: 7 }, interval: null };
        const [vote, factor, period] = await Promise.all([
            getIndicatorAssessmentWithReason('2330.TW'),
            getFourFactorAssessmentWithReason('2330.TW', preference),
            getPeriodAssessment('2330.TW'),
        ]);
        expect(vote).toMatchObject({ assessment: null, reason: 'insufficient-data', candleCount: 59 });
        expect(factor).toMatchObject({ reason: null, candleCount: 59, assessment: { interval: '1d', source: { provider: 'finmind' } } });
        expect(factor.assessment?.factors.M.score).not.toBeNull();
        expect(factor.assessment?.factors.R.score).toBeNull();
        expect(factor.assessment?.idsFactor.validCount).toBeGreaterThan(0);
        expect(period).toBeNull();
    });

    it('uses 4h only for crypto factors and preserves daily votes and period variants', async () => {
        const fetcher = vi.fn(async (input: string) => {
            const url = new URL(input);
            if (url.hostname !== 'data-api.binance.vision') return json({}, 404);
            const hourly = url.searchParams.get('interval') === '4h';
            const values = hourly ? rows(59).map((r, i) => {
                const c = 150 + i * 0.7;
                return { ...r, t: Date.parse('2026-10-03T00:00:00Z') + i * 4 * 3600_000,
                    o: c - 1, h: c + 2, l: c - 2, c, v: i === 58 ? undefined : r.v };
            }) : rows(270);
            return json(values.map(r => [r.t, String(r.o), String(r.h), String(r.l), String(r.c), String(r.v), r.t + (hourly ? 4 * 3600_000 : 86400_000) - 1]));
        });
        vi.stubGlobal('fetch', fetcher);
        const { getIndicatorAssessmentWithReason, getFourFactorAssessmentWithReason, getPeriodAssessment, getFactorAssessment } = await import('@/lib/actions/indicators.actions');
        const preference = { market: 'crypto', preset: 'short', periods: { T: 10, M: 10, V: 10, R: 10 }, interval: '4h' };
        const [vote, factor, period, legacy] = await Promise.all([
            getIndicatorAssessmentWithReason('BINANCE:BTCUSDT'),
            getFourFactorAssessmentWithReason('BINANCE:BTCUSDT', preference),
            getPeriodAssessment('BINANCE:BTCUSDT'),
            getFactorAssessment('BINANCE:BTCUSDT'),
        ]);
        expect(vote.assessment?.results).toHaveLength(57);
        expect(factor).toMatchObject({ reason: null, candleCount: 59, assessment: { interval: '4h' } });
        expect(factor.assessment?.factors.M.n).toBe(10);
        expect(factor.assessment?.factors.V.score).toBeNull();
        expect(factor.assessment?.factors.R.score).toBeNull();
        expect(period).toEqual({ variants: legacy?.variants, idsPeriod: legacy?.idsPeriod });
        expect(fetcher.mock.calls.filter(([url]) => new URL(url).searchParams.get('interval') === '4h')).toHaveLength(1);
    });

    it('rejects a forged market and uses daily stock candles even with a 4h preference', async () => {
        const fetcher = marketFetch();
        vi.stubGlobal('fetch', fetcher);
        const { getFourFactorAssessmentWithReason } = await import('@/lib/actions/indicators.actions');
        const forged = { market: 'crypto', preset: 'short', periods: { T: 10, M: 10, V: 10, R: 10 }, interval: '4h' };
        const result = await getFourFactorAssessmentWithReason('AAPL', forged);
        expect(result).toMatchObject({ assessment: null, reason: 'invalid-preference', candleCount: 0 });
        expect(fetcher).not.toHaveBeenCalled();
        const valid = await getFourFactorAssessmentWithReason('AAPL', { market: 'us', preset: 'short', periods: { T: 7, M: 7, V: 7, R: 7 }, interval: null });
        expect(valid.assessment).toMatchObject({ interval: '1d', source: { provider: 'alpaca' } });
        expect(fetcher.mock.calls.every(([url]) => !new URL(url).searchParams.has('interval'))).toBe(true);
    });

    it('reports invalid factor periods without fetching candles', async () => {
        const fetcher = marketFetch();
        vi.stubGlobal('fetch', fetcher);
        const { getFourFactorAssessmentWithReason } = await import('@/lib/actions/indicators.actions');
        const result = await getFourFactorAssessmentWithReason('2330.TW', { market: 'taiwan', preset: 'custom', periods: { T: 0, M: 14, V: 14, R: 14 }, interval: null });
        expect(result).toMatchObject({ assessment: null, reason: 'invalid-preference', candleCount: 0 });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('keeps international symbols on fixed daily n14 factors and the legacy wrapper', async () => {
        const finnHub = vi.mocked((await import('@/lib/actions/finnhub.actions')).getCandlesWithReason);
        const values = rows(270);
        finnHub.mockResolvedValue({
            candles: { s: 'ok', t: values.map(r => r.t / 1000), o: values.map(r => r.o), h: values.map(r => r.h),
                l: values.map(r => r.l), c: values.map(r => r.c), v: values.map(r => r.v), volumeComplete: true },
            reason: null, source: { provider: 'finnhub', symbol: 'VOD.L', timeZone: 'UTC' },
        });
        const { getFourFactorAssessmentWithReason, getFactorAssessment, getPeriodAssessment } = await import('@/lib/actions/indicators.actions');
        const [factor, legacy, period] = await Promise.all([
            getFourFactorAssessmentWithReason('VOD.L', { market: 'us', preset: 'short', periods: { T: 7, M: 7, V: 7, R: 7 }, interval: null }),
            getFactorAssessment('VOD.L'), getPeriodAssessment('VOD.L'),
        ]);
        expect(factor).toMatchObject({ reason: null, candleCount: 270, assessment: { interval: '1d', source: { provider: 'finnhub' } } });
        expect(factor.assessment?.factors.T.n).toBe(14);
        expect(factor.assessment?.factors.M.score).not.toBeNull();
        expect(legacy?.factors.M.n).toBe(14);
        expect(legacy?.variants).toEqual(period?.variants);
    });

    it.each([42, {}, ['AAPL']])('returns failure for a non-string symbol %j without loading candles', async (symbol) => {
        const fetcher = marketFetch();
        vi.stubGlobal('fetch', fetcher);
        const finnHub = vi.mocked((await import('@/lib/actions/finnhub.actions')).getCandlesWithReason);
        finnHub.mockClear();
        const { getFourFactorAssessmentWithReason, getFactorAssessment } = await import('@/lib/actions/indicators.actions');
        const preference = { market: 'us', preset: 'legacy', periods: { T: 14, M: 14, V: 14, R: 14 }, interval: null };
        expect(await getFourFactorAssessmentWithReason(symbol as string, preference)).toMatchObject({ assessment: null, reason: 'unsupported-symbol', candleCount: 0 });
        expect(await getFactorAssessment(symbol as string)).toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
        expect(finnHub).not.toHaveBeenCalled();
    });
});

describe('rendered stock details', () => {
    it('keeps factors visible when 59 bars cannot produce the 57-vote assessment', async () => {
        vi.stubGlobal('fetch', marketFetch(59));
        const { default: Dashboard } = await import('@/components/stocks/IndicatorDashboard');
        const html = renderToStaticMarkup(await resolveServerTree(await Dashboard({ symbol: '2330.TW' })));
        expect(html).toContain('資料不足');
        expect(html).toContain('四因素評分');
        expect(html).toContain('現行預設');
        expect(html).toContain('暫時套用');
        expect(html).not.toContain('IDS-Period');
    });

    it.each(['BINANCE:BTCUSDT', '2330.TW', 'CG:bitcoin'])('shows voting, factors and IDS for %s', async (symbol) => {
        const fetcher = marketFetch();
        vi.stubGlobal('fetch', fetcher);
        const { default: Page } = await import('@/app/(root)/stocks/[symbol]/page');
        const html = renderToStaticMarkup(await resolveServerTree(await Page({ params: Promise.resolve({ symbol: encodeURIComponent(symbol) }) })));
        expect(html).toContain('技術投票方向');
        expect(html).toContain('四因素評分');
        expect(html).toContain('IDS-Period');
        expect(html).toContain('資料日期');
        expect(html).toContain('跨市場不可直接比較');
        expect(html).toContain('樣本');
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

    it('shows a preference validation failure as a settings error', async () => {
        const { default: FactorSettings } = await import('@/components/stocks/FactorSettings');
        const { defaultFactorPreference } = await import('@/lib/indicators/factor-periods');
        const html = renderToStaticMarkup(<FactorSettings symbol="AAPL"
            initialPreference={defaultFactorPreference('us')}
            initialResponse={{ assessment: null, reason: 'invalid-preference', candleCount: 0 }}
            readError={false} />);
        expect(html).toContain('四因素設定無效');
        expect(html).not.toContain('行情服務暫時無法使用');
        expect(html).toContain('grid grid-cols-2');
        expect(html).toContain('min-h-11');
        expect(html).toContain('text-[16px]');
    });

    it('keeps international factors fixed at daily n14 without settings', async () => {
        const { default: FactorSettings } = await import('@/components/stocks/FactorSettings');
        const html = renderToStaticMarkup(<FactorSettings symbol="VOD.L" initialPreference={null}
            initialResponse={{ assessment: null, reason: 'no-data', candleCount: 0 }} readError={false} />);
        expect(html).toContain('國際市場沿用固定日 K、四因素 n=14');
        expect(html).not.toContain('儲存市場偏好');
    });
});

// Browser acceptance cases (require a signed-in local app and live providers):
// 1. BINANCE:BTCUSDT: set T/M/V/R independently, switch 4h→8h→12h→1d; each N stays unchanged.
// 2. Preview updates only this page; navigating to CG:bitcoin still reads the stored crypto preference.
// 3. Save crypto settings, then open CG:bitcoin and confirm the same market preference; a failed save preserves inputs.
// 4. 57 votes, IDS-Indicator, IDS-Period and PeriodExplorer keep their daily values through previews.
// 5. Check AAPL, 2330.TW, BINANCE:BTCUSDT and CG:bitcoin at 320px/375px: no horizontal scroll;
//    factors/inputs two columns, intervals 2×2, presets three equal columns, controls ≥44px, number text ≥16px.
