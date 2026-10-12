import { describe, expect, it, vi } from 'vitest';

// These markets never need Finnhub. Avoid booting unrelated MongoDB/auth services.
vi.mock('@/lib/actions/finnhub.actions', () => ({
    getCandlesWithReason: vi.fn().mockResolvedValue({ candles: null, reason: 'api-error', source: null }),
}));

describe.skipIf(process.env.LIVE_MARKET_DATA !== '1')('public market data smoke tests (network opt-in)', () => {
    it.each(['BINANCE:BTCUSDT', '2330.TW', '6488.TWO'])('computes indicators from real %s daily history', async (symbol) => {
        const { getIndicatorAssessmentWithReason, getFactorAssessment } = await import('@/lib/actions/indicators.actions');
        const [{ assessment, reason, candleCount }, factors] = await Promise.all([
            getIndicatorAssessmentWithReason(symbol), getFactorAssessment(symbol),
        ]);
        expect(reason).toBeNull();
        expect(candleCount).toBeGreaterThanOrEqual(200);
        expect(assessment?.results).toHaveLength(57);
        expect(assessment?.ids.idsPct).not.toBeNull();
        expect(factors?.factors.T.score).not.toBeNull();
        console.info(JSON.stringify({ symbol, candleCount, source: assessment?.source, asof: assessment?.asof, ids: assessment?.ids.idsPct }));
    }, 20000);
});
