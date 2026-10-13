import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/better-auth/auth', () => ({
    getSession: vi.fn().mockResolvedValue(null),
    requireUserId: vi.fn().mockResolvedValue('test-user'),
}));

vi.mock('@/database/mongoose', () => ({
    connectToDatabase: vi.fn().mockResolvedValue(true),
}));

import { createSearchSequenceGuard, isImeComposing } from '../components/SearchCommand';
import { formatWatchlistPrice, formatWatchlistChange, isTaiwanWatchlistSymbol } from '../components/watchlist/WatchlistTable';

describe('SearchCommand UI logic and safeguards', () => {
    it('prevents earlier slow searches from overwriting newer search results (sequence guard)', async () => {
        const guard = createSearchSequenceGuard<string[]>();

        // User types '2' -> initiates request 1
        const seq1 = guard.next();

        // User quickly types '2330' -> initiates request 2
        const seq2 = guard.next();

        expect(seq2).toBeGreaterThan(seq1);

        let latestResults: string[] = [];

        // Simulated asynchronous callbacks:
        // Request 2 finishes FAST:
        if (guard.isLatest(seq2)) {
            latestResults = ['TWSE:2330'];
        }
        expect(latestResults).toEqual(['TWSE:2330']);

        // Request 1 finishes SLOW:
        if (guard.isLatest(seq1)) {
            latestResults = ['OLD_SLOW_RESULTS'];
        }

        // Must still have request 2's results!
        expect(latestResults).toEqual(['TWSE:2330']);
    });

    it('guards against IME composition Enter key triggering navigation', () => {
        // Normal Enter (not in composition)
        const normalEnter = { key: 'Enter', isComposing: false, keyCode: 13 };
        expect(isImeComposing(normalEnter)).toBe(false);

        // IME composition Enter in modern browsers (isComposing = true)
        const imeEnter1 = { key: 'Enter', isComposing: true, keyCode: 13 };
        expect(isImeComposing(imeEnter1)).toBe(true);

        // IME composition Enter via nativeEvent.isComposing
        const imeEnter2 = { key: 'Enter', nativeEvent: { isComposing: true }, keyCode: 13 };
        expect(isImeComposing(imeEnter2)).toBe(true);

        // IME composition keyCode 229 (common on mobile / some CJK IMEs)
        const imeEnter3 = { key: 'Enter', isComposing: false, keyCode: 229 };
        expect(isImeComposing(imeEnter3)).toBe(true);
    });
});

describe('WatchlistTable presentation and helpers', () => {
    it('identifies Taiwan symbols to exclude them from 15s live quote polling', () => {
        expect(isTaiwanWatchlistSymbol('TWSE:2330')).toBe(true);
        expect(isTaiwanWatchlistSymbol('TPEX:6488')).toBe(true);
        expect(isTaiwanWatchlistSymbol('2330.TW')).toBe(true);
        expect(isTaiwanWatchlistSymbol('6488.TWO')).toBe(true);

        expect(isTaiwanWatchlistSymbol('AAPL')).toBe(false);
        expect(isTaiwanWatchlistSymbol('MSFT')).toBe(false);
        expect(isTaiwanWatchlistSymbol('BINANCE:BTCUSDT')).toBe(false);
    });

    it('formats price correctly: displays "—" on null, formats currency when known, omits "$" on unknown currency', () => {
        expect(formatWatchlistPrice(null, 'TWD')).toBe('—');
        expect(formatWatchlistPrice(undefined, 'USD')).toBe('—');

        // Known currency TWD
        const twdPrice = formatWatchlistPrice(1020, 'TWD');
        expect(twdPrice).toContain('1,020');

        // Known currency USD
        const usdPrice = formatWatchlistPrice(150, 'USD');
        expect(usdPrice).toContain('150.00');

        // Unknown currency: must NOT display $ or USD!
        const unknownPrice = formatWatchlistPrice(100, null);
        expect(unknownPrice).not.toContain('$');
        expect(unknownPrice).not.toContain('USD');
        expect(unknownPrice).toBe('100.00');
    });

    it('formats change correctly: null price or null change displays "—", 0 change displays "0.00"', () => {
        // Missing quote or null price
        expect(formatWatchlistChange(null, null)).toBe('—');
        expect(formatWatchlistChange(null, 100)).toBe('—');
        expect(formatWatchlistChange(5, null)).toBe('—');

        // Zero change displays 0.00, not —
        expect(formatWatchlistChange(0, 100)).toBe('0.00');

        // Positive change
        expect(formatWatchlistChange(15.5, 1000)).toBe('+15.50');

        // Negative change
        expect(formatWatchlistChange(-8, 500)).toBe('-8.00');
    });
});
