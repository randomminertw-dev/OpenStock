import { it, expect } from 'vitest';
import { mergeReportHistory } from './history';
import type { PublishedResearchReport } from './types';
it('never carries another symbol into the current report history after a failed read', () => {
    const old = { id: 'a', snapshot: { symbol: 'AAPL' } } as PublishedResearchReport;
    const next = { id: 'b', snapshot: { symbol: 'TSLA' } } as PublishedResearchReport;
    expect(mergeReportHistory([old], next)).toEqual([next]);
    expect(mergeReportHistory([next], next)).toEqual([next]);
});
