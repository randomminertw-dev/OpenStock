import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaiwanBar, TaiwanDetails as TaiwanDetailsData, TaiwanHistoryStatus as TaiwanHistoryStatusData, TaiwanQuote, TaiwanSecurity } from '@/lib/taiwan/types';
import { createInMemoryTaiwanRepository } from '@/lib/taiwan/repository';
import { setTaiwanRepositoryForTesting } from '@/lib/taiwan/reads';

// Mock DB and external calls
vi.mock('@/lib/better-auth/auth', () => ({
    getSession: vi.fn().mockResolvedValue({ user: { id: 'test-user-id' } }),
    requireUserId: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/database/mongoose', () => ({
    connectToDatabase: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/actions/watchlist.actions', () => ({
    isStockInWatchlist: vi.fn().mockResolvedValue(false),
    addToWatchlist: vi.fn().mockResolvedValue(true),
    removeFromWatchlist: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/actions/adanos.actions', () => ({
    getStockSentimentInsights: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/components/TradingViewWidget', () => ({
    default: ({ scriptUrl }: { scriptUrl: string }) => (
        <div data-testid="tv-widget" data-script={scriptUrl}>
            TradingView Widget: {scriptUrl}
        </div>
    ),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/components/stocks/IndicatorDashboard', () => ({
    default: ({ symbol }: { symbol: string }) => (
        <div data-testid="indicator-dashboard">指標面板: {symbol}</div>
    ),
}));

async function resolveServerTree(node: React.ReactNode): Promise<React.ReactNode> {
    if (Array.isArray(node)) return Promise.all(node.map(resolveServerTree));
    if (!React.isValidElement(node)) return node;
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    if (typeof element.type === 'function' && element.type.constructor.name === 'AsyncFunction') {
        return resolveServerTree(await (element.type as (props: unknown) => Promise<React.ReactNode>)(element.props));
    }
    if (element.props.children === undefined) return element;
    return React.cloneElement(element, undefined, await resolveServerTree(element.props.children));
}

import TaiwanHeader from '@/components/stocks/TaiwanHeader';
import TaiwanChart from '@/components/stocks/TaiwanChart';
import TaiwanDetails from '@/components/stocks/TaiwanDetails';
import TaiwanHistoryStatus from '@/components/stocks/TaiwanHistoryStatus';
import StockDetails from '@/app/(root)/stocks/[symbol]/page';

describe('Taiwan native components and stock page', () => {
    let repo: ReturnType<typeof createInMemoryTaiwanRepository>;

    beforeEach(() => {
        repo = createInMemoryTaiwanRepository();
        setTaiwanRepositoryForTesting(repo);
    });

    describe('TaiwanHeader', () => {
        it('renders official closing price, trading date, "收盤", alerts pill, and watchlist button', async () => {
            const sec: TaiwanSecurity = {
                exchange: 'TWSE',
                code: '2330',
                symbol: 'TWSE:2330',
                name: '台積電',
                kind: 'stock',
                currency: 'TWD',
                listingDate: '1994-09-05',
                status: 'active',
                metadata: {},
                source: 'twse',
                asof: '2026-10-13',
            };
            const quote: TaiwanQuote = {
                exchange: 'TWSE',
                code: '2330',
                price: 1045,
                change: 15,
                changePercent: 1.46,
                currency: 'TWD',
                tradingDate: '2026-10-13',
                source: 'twse',
                mode: 'close',
                stale: false,
            };

            const html = renderToStaticMarkup(
                await TaiwanHeader({ security: sec, quote, symbol: 'TWSE:2330' })
            );

            expect(html).toContain('台積電');
            expect(html).toContain('收盤');
            expect(html).toContain('2026-10-13');
            expect(html).toContain('Alerts: US stocks and crypto');
            expect(html).toContain('1,045');
        });

        it('does not display USD or $ when currency is null or unknown', async () => {
            const sec: TaiwanSecurity = {
                exchange: 'TWSE',
                code: '9999',
                symbol: 'TWSE:9999',
                name: '測試未知幣別',
                kind: 'stock',
                currency: null,
                listingDate: null,
                status: 'active',
                metadata: {},
                source: 'twse',
                asof: '2026-10-13',
            };
            const quote: TaiwanQuote = {
                exchange: 'TWSE',
                code: '9999',
                price: 123.45,
                change: 0,
                changePercent: 0,
                currency: null,
                tradingDate: '2026-10-13',
                source: 'twse',
                mode: 'close',
                stale: false,
            };

            const html = renderToStaticMarkup(
                await TaiwanHeader({ security: sec, quote, symbol: 'TWSE:9999' })
            );

            expect(html).toContain('123.45');
            expect(html).not.toContain('USD');
            expect(html).not.toContain('$');
        });
    });

    describe('TaiwanChart', () => {
        const sampleBars: TaiwanBar[] = [
            {
                exchange: 'TPEX',
                code: '6488',
                tradingDate: '2026-09-01',
                t: 1788220800000,
                o: 480,
                h: 495,
                l: 478,
                c: 492,
                v: 13645310, // Exact shares: 13,645,310 (not lots 12,770)
                change: 12,
                complete: true,
                source: 'tpex',
                priceBasis: 'unadjusted',
                fetchedAt: '2026-09-01T15:00:00Z',
            },
        ];

        it('renders exact share volume (13,645,310) instead of lots/張', () => {
            const html = renderToStaticMarkup(
                <TaiwanChart bars={sampleBars} events={[]} />
            );

            expect(html).toContain('13,645,310');
            expect(html).not.toContain('12,770');
            expect(html).toContain('未調整價格');
        });

        it('has zero division guard for empty bars without throwing', () => {
            expect(() => {
                const html = renderToStaticMarkup(
                    <TaiwanChart bars={[]} events={[]} />
                );
                expect(html).toContain('無歷史 K 線資料');
            }).not.toThrow();
        });

        it('has zero division guard for a single bar without NaN or zero division errors', () => {
            expect(() => {
                const html = renderToStaticMarkup(
                    <TaiwanChart bars={sampleBars} events={[]} />
                );
                expect(html).not.toContain('NaN');
                expect(html).toContain('svg');
            }).not.toThrow();
        });
    });

    describe('TaiwanDetails', () => {
        it('renders ETF info and strictly omits company PE / EPS', () => {
            const sec: TaiwanSecurity = {
                exchange: 'TWSE',
                code: '0050',
                symbol: 'TWSE:0050',
                name: '元大台灣50',
                kind: 'etf',
                currency: 'TWD',
                listingDate: '2003-06-30',
                status: 'active',
                metadata: {
                    indexName: '臺灣50指數',
                    issuer: '元大證券投資信託',
                    fundType: '國內指數股票型',
                },
                source: 'twse',
                asof: '2026-10-13',
            };
            const details: TaiwanDetailsData = {
                security: sec,
                fields: [
                    { label: '追蹤指數', value: '臺灣50指數', period: null, unit: null },
                    { label: '發行人', value: '元大證券投資信託', period: null, unit: null },
                    { label: '基金類型', value: '國內指數股票型', period: null, unit: null },
                ],
                announcements: [],
                events: [],
                asof: '2026-10-13',
            };

            const html = renderToStaticMarkup(<TaiwanDetails details={details} />);

            expect(html).toContain('臺灣50指數');
            expect(html).toContain('元大證券投資信託');
            expect(html).toContain('國內指數股票型');
            // STRICTLY NO PE or EPS for ETFs!
            expect(html).not.toContain('本益比');
            expect(html).not.toContain('每股盈餘');
            expect(html).not.toContain('PE ratio');
        });

        it('strips malicious HTML to plain text and rejects javascript: links in announcements', () => {
            const sec: TaiwanSecurity = {
                exchange: 'TWSE',
                code: '2330',
                symbol: 'TWSE:2330',
                name: '台積電',
                kind: 'stock',
                currency: 'TWD',
                listingDate: '1994-09-05',
                status: 'active',
                metadata: {},
                source: 'twse',
                asof: '2026-10-13',
            };
            const details: TaiwanDetailsData = {
                security: sec,
                fields: [
                    { label: '本益比', value: '25.6', period: null, unit: '倍' },
                    { label: '基本每股盈餘', value: '40.5', period: '2026 Q2', unit: '元' },
                ],
                announcements: [
                    {
                        date: '2026-10-13',
                        title: '<b>重大訊息公告</b><script>alert("xss")</script>',
                        body: '<img src=x onerror=alert(1)>台積電董事會決議發行無擔保普通公司債',
                        sourceUrl: 'javascript:alert("malicious")',
                    },
                ],
                events: [],
                asof: '2026-10-13',
            };

            const html = renderToStaticMarkup(<TaiwanDetails details={details} />);

            expect(html).toContain('本益比');
            expect(html).toContain('25.6');
            expect(html).toContain('重大訊息公告');
            expect(html).toContain('台積電董事會決議');
            // Ensure raw scripts/images/javascript URLs are eliminated
            expect(html).not.toContain('<script>');
            expect(html).not.toContain('<img');
            expect(html).not.toContain('href="javascript:');
        });
    });

    describe('TaiwanHistoryStatus', () => {
        it('renders sync disabled message when state is disabled', () => {
            const status: TaiwanHistoryStatusData = {
                state: 'disabled',
                completed: 0,
                total: 0,
                candleCount: 0,
                reason: null,
            };

            const html = renderToStaticMarkup(
                <TaiwanHistoryStatus symbol="TWSE:2330" initial={status} />
            );

            expect(html).toContain('同步尚未啟用');
        });

        it('renders candleCount and progress with retry button when state is partial', () => {
            const status: TaiwanHistoryStatusData = {
                state: 'partial',
                completed: 12,
                total: 24,
                candleCount: 250,
                reason: null,
            };

            const html = renderToStaticMarkup(
                <TaiwanHistoryStatus symbol="TWSE:2330" initial={status} />
            );

            expect(html).toContain('250');
            expect(html).toContain('12');
            expect(html).toContain('24');
            expect(html).toContain('重試');
        });
    });

    describe('Page integration for Taiwan symbols', () => {
        it('renders 0050 with official closing date, ETF info, TV supplementary quote, and no 1h TV technicals', async () => {
            const sec: TaiwanSecurity = {
                exchange: 'TWSE',
                code: '0050',
                symbol: 'TWSE:0050',
                name: '元大台灣50',
                kind: 'etf',
                currency: 'TWD',
                listingDate: '2003-06-30',
                status: 'active',
                metadata: {
                    indexName: '臺灣50指數',
                    issuer: '元大證券投資信託',
                    fundType: '國內指數股票型',
                },
                source: 'twse',
                asof: '2026-10-13',
            };
            const bar: TaiwanBar = {
                exchange: 'TWSE',
                code: '0050',
                tradingDate: '2026-10-13',
                t: 1788220800000,
                o: 195,
                h: 198,
                l: 194,
                c: 197.5,
                v: 25000000,
                change: 2.5,
                complete: true,
                source: 'twse',
                priceBasis: 'unadjusted',
                fetchedAt: '2026-10-13T15:00:00Z',
            };

            await repo.writeCatalog([sec]);
            await repo.writeBars([bar]);

            const jsx = await StockDetails({ params: Promise.resolve({ symbol: '0050' }) });
            const html = renderToStaticMarkup(await resolveServerTree(jsx));

            // 1. Official closing date and quote
            expect(html).toContain('元大台灣50');
            expect(html).toContain('收盤');
            expect(html).toContain('2026-10-13');

            // 2. ETF info
            expect(html).toContain('臺灣50指數');
            expect(html).toContain('元大證券投資信託');

            // 3. STRICTLY NO company PE / EPS
            expect(html).not.toContain('本益比');
            expect(html).not.toContain('每股盈餘');

            // 4. Supplementary TradingView source label
            expect(html).toContain('TradingView 報價，依其可用資料');

            // 5. NO 1h TradingView technicals or financials
            expect(html).not.toContain('technical-analysis.js');
            expect(html).not.toContain('financials.js');
            expect(html).not.toContain('symbol-profile.js');
        });
    });

    describe('Server Actions & Security guarantees', () => {
        it('getTaiwanPageData loads security, quote, history, and details together', async () => {
            const { getTaiwanPageData } = await import('@/lib/actions/taiwan.actions');

            const sec: TaiwanSecurity = {
                exchange: 'TWSE',
                code: '2330',
                symbol: 'TWSE:2330',
                name: '台積電',
                kind: 'stock',
                currency: 'TWD',
                listingDate: '1994-09-05',
                status: 'active',
                metadata: {},
                source: 'twse',
                asof: '2026-10-13',
            };
            await repo.writeCatalog([sec]);

            const pageData = await getTaiwanPageData('TWSE:2330');
            expect(pageData).toBeDefined();
            expect(pageData.security?.code).toBe('2330');
            expect(pageData.quote).toBeDefined();
            expect(pageData.history).toBeDefined();
            expect(Array.isArray(pageData.history.bars)).toBe(true);
            expect(pageData.details).toBeDefined();
        });

        it('requestTaiwanHistoryAction enforces authentication and returns clean status DTO without raw URLs or jobKeys', async () => {
            const { requestTaiwanHistoryAction } = await import('@/lib/actions/taiwan.actions');
            const { requireUserId } = await import('@/lib/better-auth/auth');

            const sec: TaiwanSecurity = {
                exchange: 'TWSE',
                code: '2330',
                symbol: 'TWSE:2330',
                name: '台積電',
                kind: 'stock',
                currency: 'TWD',
                listingDate: '1994-09-05',
                status: 'active',
                metadata: {},
                source: 'twse',
                asof: '2026-10-13',
            };
            await repo.writeCatalog([sec]);

            const status = await requestTaiwanHistoryAction('TWSE:2330', 800);
            expect(requireUserId).toHaveBeenCalled();
            expect(status).toHaveProperty('state');
            expect(status).toHaveProperty('candleCount');
            // Strictly does not expose internal jobKeys or raw URLs
            expect(status).not.toHaveProperty('jobKey');
            expect(status).not.toHaveProperty('url');
            expect(status).not.toHaveProperty('upstreamUrl');
        });

        it('StockHeader routes Taiwan symbols to TaiwanHeader', async () => {
            const { default: StockHeader } = await import('@/components/stocks/StockHeader');

            const sec: TaiwanSecurity = {
                exchange: 'TPEX',
                code: '6488',
                symbol: 'TPEX:6488',
                name: '環球晶',
                kind: 'stock',
                currency: 'TWD',
                listingDate: '2015-09-25',
                status: 'active',
                metadata: {},
                source: 'tpex',
                asof: '2026-10-13',
            };
            await repo.writeCatalog([sec]);

            const jsx = await StockHeader({ symbol: '6488' });
            const html = renderToStaticMarkup(jsx);

            expect(html).toContain('環球晶');
            expect(html).toContain('TPEX');
            expect(html).toContain('Alerts: US stocks and crypto');
        });
    });
});
