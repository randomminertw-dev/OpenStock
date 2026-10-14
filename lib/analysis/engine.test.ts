import { describe, expect, it } from 'vitest';
import { createResearchSnapshot } from './snapshot';
import { analyzeResearch } from './engine';
import { renderResearchMarkdown } from './template';
import { defaultFactorPreference } from '@/lib/indicators/factor-periods';

export function fixture(count = 600) {
    const end = Date.parse('2026-10-14T00:00:00Z') / 1000;
    return Array.from({ length: count }, (_, i) => ({ t: end - (count - 1 - i) * 86400,
        o: 100 + i * 0.3, h: 103 + i * 0.3, l: 99 + i * 0.3, c: 102 + i * 0.3, v: 1000 + i * 5 }));
}
function snapshot() {
    return createResearchSnapshot({ symbol: 'BINANCE:BTCUSDT', source: { provider: 'binance', symbol: 'BTCUSDT', timeZone: 'UTC' },
        candles: fixture(), preference: defaultFactorPreference('crypto'), now: new Date('2026-10-15T12:00:00Z') });
}
describe('research rules and template', () => {
    it('produces bullish short/medium/long technical observations from the existing factor votes', () => {
        const input = snapshot(); const result = analyzeResearch(input);
        expect(result.directions.map(d => d.direction)).toEqual(['bullish', 'bullish', 'bullish']);
        expect(result.evidence.bullish.length).toBeGreaterThan(0);
        expect(result.levels.every(l => Number.isFinite(l.value) && l.value > 0)).toBe(true);
        expect(result.levels.some(l => l.indicatorId === 'sma200')).toBe(true);
        expect(result.levels.some(l => ['pricechannel', 'kd', 'macd', 'ema1226'].includes(l.indicatorId))).toBe(false);
    });
    it('does not use volatility risk as a direction vote and preserves opposing evidence', () => {
        const input = snapshot();
        input.factors.R.atrPct = 9;
        for (const profile of input.profiles) {
            profile.factors.T.score = -2; profile.factors.M.score = -50; profile.factors.V.score = 30;
            profile.ids = { idsPct: 66.666, upPct: 33.333, downPct: 66.666, neutralPct: 0, validCount: 3 };
        }
        input.indicators[0] = { id: 'opposing', name: '反對證據', category: 'trend', value: 2, signal: -1, reason: '有效下行訊號' };
        const result = analyzeResearch(input);
        expect(result.directions.every(d => d.direction === 'bearish')).toBe(true);
        expect(result.evidence.bearish.some(e => e.id === 'opposing')).toBe(true);
        expect(result.conflicts.length).toBeGreaterThan(0);
        expect(result.risks.join('')).toContain('9.00%');
    });
    it('distinguishes neutral evidence from missing evidence without inventing probabilities', () => {
        const input = snapshot();
        input.indicators = input.indicators.map(r => ({ ...r, value: null, signal: null }));
        for (const profile of input.profiles) { profile.factors.T.score = null; profile.ids.validCount = 0; }
        const result = analyzeResearch(input);
        expect(result.directions.every(d => d.direction === 'insufficient')).toBe(true);
        expect(result.levels).toEqual([]);
        const markdown = renderResearchMarkdown(input, result);
        expect(markdown).toContain('證據不足');
        expect(markdown).toContain('N/A');
        expect(markdown).not.toMatch(/上漲機率\s*\d|保證目標價|350–355|389\.5/);
        expect((markdown.match(/^## /gm) ?? [])).toHaveLength(9);
        expect(markdown).toContain(input.inputHash);
    });
    it('renders all-neutral factors as range observations and no fake directional evidence', () => {
        const input = snapshot();
        for (const p of input.profiles) p.ids = { idsPct: null, upPct: 0, downPct: 0, neutralPct: 100, validCount: 3 };
        expect(analyzeResearch(input).directions.every(d => d.direction === 'range')).toBe(true);
    });
});
