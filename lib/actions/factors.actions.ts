'use server';

import { cache } from 'react';
import { getCandles, getNews } from './finnhub.actions';
import { buildAssessment, type FactorAssessment } from '@/lib/factors/scoring';

// Technical indicators need enough history (SMA50 + MACD + RSI + Bollinger);
// skip the whole technical side below this.
const MIN_CANDLES = 60;

async function fetchFactorAssessment(symbol: string): Promise<FactorAssessment | null> {
    const clean = (symbol || '').trim().toUpperCase();
    if (!clean) return null;

    const [candlesResult, newsResult] = await Promise.allSettled([
        getCandles(clean),
        getNews([clean]),
    ]);

    const candles = candlesResult.status === 'fulfilled' ? candlesResult.value : null;
    const articles = newsResult.status === 'fulfilled' ? newsResult.value : [];

    const closes = candles && candles.c.length >= MIN_CANDLES ? candles.c : null;

    // Nothing to score on either side
    if (!closes && articles.length === 0) return null;

    return buildAssessment(clean, closes, articles, new Date().toISOString());
}

// Deduped per render: the page wrapper and the panel can both call it safely
export const getFactorAssessment = cache(fetchFactorAssessment);
