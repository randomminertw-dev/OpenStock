import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/better-auth/auth', () => ({
    getSession: vi.fn().mockResolvedValue(null),
    requireUserId: vi.fn().mockResolvedValue('test-user'),
}));

vi.mock('@/database/mongoose', () => ({
    connectToDatabase: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/components/ui/command', () => ({
    CommandDialog: ({ open, children, className }: { open?: boolean; children?: React.ReactNode; className?: string }) =>
        open ? <div className={className}>{children}</div> : null,
    CommandInput: ({ placeholder, value }: { placeholder?: string; value?: string }) => (
        <input placeholder={placeholder} defaultValue={value} />
    ),
    CommandList: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
    CommandEmpty: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import SearchCommand, { createSearchSequenceGuard, getSearchIndicatorText, isImeComposing } from '../components/SearchCommand';
import WatchlistTable, { formatWatchlistPrice, formatWatchlistChange, isTaiwanWatchlistSymbol } from '../components/watchlist/WatchlistTable';

describe('SearchCommand UI logic and safeguards', () => {
    it('prevents earlier slow searches from overwriting newer search results or cleared state (sequence guard)', async () => {
        const guard = createSearchSequenceGuard();

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

        // User clears the search bar (isSearchMode = false) -> sequence advances
        const seqCleared = guard.next();
        expect(seqCleared).toBeGreaterThan(seq2);
        const popularStocks = ['TWSE:2330', 'TWSE:0050'];
        latestResults = popularStocks;

        // In-flight slow search callback resolving late after search was cleared:
        if (guard.isLatest(seq2)) {
            latestResults = ['OVERWRITTEN_BY_SLOW_INFLIGHT'];
        }
        expect(latestResults).toEqual(popularStocks);
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

    it('displays readiness / uninitialized index error in search-list-indicator and does not claim "Nothing matches"', () => {
        // Direct helper logic test
        const indicatorWithDbError = getSearchIndicatorText({
            errorMessage: '台股資料庫準備中或同步未啟用',
            isSearchMode: true,
            searchTerm: '2330',
        });
        expect(indicatorWithDbError).toBe('台股資料庫準備中或同步未啟用');
        expect(indicatorWithDbError).not.toContain('Nothing matches');

        // Normal search empty state
        const indicatorNormalEmpty = getSearchIndicatorText({
            errorMessage: null,
            isSearchMode: true,
            searchTerm: 'UNKNOWN',
        });
        expect(indicatorNormalEmpty).toBe('Nothing matches “UNKNOWN”');

        // Rendered component verification
        const html = renderToStaticMarkup(
            <SearchCommand
                initialStocks={[]}
                defaultOpen={true}
                initialMounted={true}
                initialErrorMessage="台股資料庫準備中或同步未啟用"
                initialSearchTerm="2330"
            />
        );

        expect(html).toContain('search-list-indicator');
        expect(html).toContain('台股資料庫準備中或同步未啟用');
        expect(html).not.toContain('Nothing matches');
    });
});

describe('WatchlistTable presentation and helpers', () => {
    it('identifies Taiwan symbols to exclude them from 15s live quote polling', () => {
        expect(isTaiwanWatchlistSymbol('TWSE:2330')).toBe(true);
        expect(isTaiwanWatchlistSymbol('TPEX:6488')).toBe(true);
        expect(isTaiwanWatchlistSymbol('2330.TW')).toBe(true);
        expect(isTaiwanWatchlistSymbol('6488.TWO')).toBe(true);
        expect(isTaiwanWatchlistSymbol('0050')).toBe(true);
        expect(isTaiwanWatchlistSymbol('2330')).toBe(true);

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

    it('disables alert button for Taiwan stocks even when symbol is a bare code (e.g. 2330)', () => {
        const rows = [
            {
                symbol: '2330',
                name: '台積電',
                price: 1040,
                change: 15,
                changePercent: 1.46,
                marketCap: 27000000000000,
                tradingDate: '2026-10-13',
            },
            {
                symbol: 'AAPL',
                name: 'Apple Inc.',
                price: 230,
                change: 2.5,
                changePercent: 1.1,
                marketCap: 3500000000000,
                currency: 'USD',
            },
        ];

        const html = renderToStaticMarkup(
            <WatchlistTable initialRows={rows as Parameters<typeof WatchlistTable>[0]['initialRows']} />
        );

        // AAPL has active alert button modal trigger
        expect(html).toContain('title="Set a price alert for AAPL"');

        // 2330 must NOT have active alert button
        expect(html).not.toContain('title="Set a price alert for 2330"');
        expect(html).toContain('title="Alerts are available for US stocks and crypto"');
    });
});
