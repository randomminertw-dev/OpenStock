import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FactorCards from './FactorCards';
import type { FourFactorAssessment } from '@/lib/actions/indicators.actions';

function assessment(): FourFactorAssessment {
    return {
        factors: {
            T: { id: 'T', score: 2.5, n: 42, formulaVersion: 'sma-spread-atr-v2', reason: '(SMA100 110 − SMA400 105) ÷ ATR(42) 2 = 2.50 倍 ATR' },
            M: { id: 'M', score: 20, n: 30, formulaVersion: 'wilder-rma-v1', reason: 'RSI(30) = 60，M = 2 × RSI − 100 = 20' },
            V: { id: 'V', score: -15, n: 14, formulaVersion: 'wilder-rma-v1', reason: 'CMF(14) = -0.15，V = 100 × CMF = -15' },
            R: { id: 'R', score: 79.8804780876494, atrPct: 4, n: 21, formulaVersion: 'wilder-rma-v1', reason: 'ATR%(21) = 4%，為近 252 根歷史的第 79.9 百分位，R = 79.9', sampleCount: 252 },
        },
        idsFactor: { idsPct: null, upPct: null, downPct: null, neutralPct: null, validCount: 0 },
        asof: '2026-10-13T00:00:00.000Z',
        source: null,
        interval: '8h',
    };
}

describe('FactorCards formula explanations', () => {
    it('shows ATR% as the primary risk value and zero only as a historical rank', () => {
        const current = assessment();
        current.factors.R = {
            id: 'R', score: 0, atrPct: 2.97, n: 14, formulaVersion: 'wilder-rma-v1',
            reason: 'ATR%(14) = 2.97%，為近 252 根歷史的第 0.0 百分位（average 排名法），R = 0.00',
            sampleCount: 252,
        };
        const html = renderToStaticMarkup(<FactorCards factors={current.factors} assessment={current} />);

        expect(html).toContain('近期波動幅度');
        expect(html).toContain('>2.97%<');
        expect(html).toContain('相對自身歷史：近 252 筆最低（百分位 0／100）');
    });

    it('shows ATR% but no rank when the historical sample is too short', () => {
        const current = assessment();
        current.factors.R = {
            id: 'R', score: null, atrPct: 2.97, n: 14, formulaVersion: 'wilder-rma-v1',
            reason: '資料不足：R 需要至少 126 筆 ATR% 歷史（截至 t 當下已存在 86 筆）',
            sampleCount: 86,
        };
        const html = renderToStaticMarkup(<FactorCards factors={current.factors} assessment={current} />);

        expect(html).toContain('>2.97%<');
        expect(html).toContain('歷史排名資料不足');
        expect(html).toContain('本次 ATR%(14) = 2.97%');
        expect(html).not.toContain('相對自身歷史：近 86 筆最低');
    });

    it('shows four expandable formulas with applied N, K interval, score meaning and actual inputs', () => {
        const current = assessment();
        const html = renderToStaticMarkup(<FactorCards factors={current.factors} assessment={current} />);

        expect(html.match(/<details\b/g)).toHaveLength(4);
        expect(html.match(/公式與本次計算/g)).toHaveLength(4);
        expect(html).toContain('SMA100 − SMA400');
        expect(html).toContain('ATR(42)');
        expect(html).toContain('2 × RSI(30) − 100');
        expect(html).toContain('100 × CMF(14)');
        expect(html).toContain('ATR%(21)');
        expect(html).toContain('平均名次');
        expect(html).toContain('N=42 根 8h K 線');
        expect(html).toContain('RSI(30) = 60');
        expect(html).toContain('CMF(14) = -0.15');
        expect(html).toContain('第 79.9 百分位');
        expect(html).toContain('相對自身歷史：近 252 筆第 79.9 百分位');
        expect(html).toContain('100 × (201.5 − 1) ÷ (252 − 1) ≈ 79.9');
        expect(html).toContain('不代表漲跌方向或預測機率');
    });

    it('retains the formula and explains why an unavailable score has no calculation detail', () => {
        const current = assessment();
        current.factors.T = { ...current.factors.T, score: null, reason: '資料不足：SMA400 需要至少 400 根 K 線' };
        const html = renderToStaticMarkup(<FactorCards factors={current.factors} assessment={current} />);

        expect(html).toContain('SMA100 − SMA400');
        expect(html).toContain('資料不足：SMA400 需要至少 400 根 K 線');
        expect(html).not.toContain('SMA100 110');
        expect(html).toContain('N/A');
    });
});
