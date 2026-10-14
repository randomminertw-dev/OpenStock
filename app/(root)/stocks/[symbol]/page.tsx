import { Suspense } from "react";
import { CandlestickChart } from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";
import StockHeader, { StockHeaderSkeleton } from "@/components/stocks/StockHeader";
import StockSentimentCard from "@/components/stocks/StockSentimentCard";
import Panel from "@/components/Panel";
import {
    CANDLE_CHART_WIDGET_CONFIG,
    TECHNICAL_ANALYSIS_WIDGET_CONFIG,
    COMPANY_PROFILE_WIDGET_CONFIG,
    COMPANY_FINANCIALS_WIDGET_CONFIG,
    symbolInfoConfig,
} from "@/lib/constants";
import { getStockSentimentInsights } from '@/lib/actions/adanos.actions';
import IndicatorDashboard from "@/components/stocks/IndicatorDashboard";
import { isCoinGeckoSymbol } from "@/lib/coingecko";
import { formatSymbolForTradingView, isChartEmbeddable, tradingViewSymbolUrl } from '@/lib/utils';
import { candleMarket } from "@/lib/candles/symbols";
import TaiwanHeader from "@/components/stocks/TaiwanHeader";
import TaiwanChart from "@/components/stocks/TaiwanChart";
import TaiwanDetails from "@/components/stocks/TaiwanDetails";
import TaiwanHistoryStatus from "@/components/stocks/TaiwanHistoryStatus";
import { getTaiwanPageData } from "@/lib/actions/taiwan.actions";

const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

async function Sentiment({ symbol }: { symbol: string }) {
    const insight = await getStockSentimentInsights(symbol);
    if (!insight) return null;
    return (
        <Panel title="Sentiment" sub="Reddit, X.com, news and Polymarket">
            <StockSentimentCard insight={insight} />
        </Panel>
    );
}

async function Factors({ symbol }: { symbol: string }) {
    return (
        <Panel title="技術指標投票" sub="57 項指標分歧監控 · IDS">
            <IndicatorDashboard symbol={symbol} />
        </Panel>
    );
}

// Charts come straight from TradingView (live, no quota); only the header waits on Finnhub, and it streams.
export default async function StockDetails({ params }: StockDetailsPageProps) {
    const { symbol: rawSymbol } = await params;
    const symbol = decodeURIComponent(rawSymbol).toUpperCase();

    // Taiwan stocks & ETFs: official closing quote, native chart, details, and sync status
    if (candleMarket(symbol).kind === 'taiwan') {
        const { security, quote, history, details, isInWatchlist } = await getTaiwanPageData(symbol);
        const tvSymbol = security
            ? `${security.exchange}:${security.code}`
            : formatSymbolForTradingView(symbol);

        return (
            <>
                <TaiwanHeader
                    security={security}
                    quote={quote}
                    symbol={symbol}
                    isInWatchlist={isInWatchlist}
                />
                {quote?.price == null && history.bars.length === 0 && (
                    <div className="card p-4 mb-3" role="status">
                        <p className="text-sm font-semibold">官方台股資料尚未準備完成</p>
                        <p className="text-xs text-faint mt-1">
                            目前尚未取得此商品的官方收盤與歷史資料，完成資料同步後即可顯示報價與分析。
                        </p>
                    </div>
                )}
                <TaiwanHistoryStatus symbol={symbol} initial={history.status} />

                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
                    <div className="flex min-w-0 flex-col gap-3">
                        <Panel title="Chart" sub="官方日 K · 價量與除權息事件">
                            <TaiwanChart bars={history.bars} events={details?.events ?? []} />
                        </Panel>
                        <TaiwanDetails details={details} />
                    </div>

                    <div className="flex min-w-0 flex-col gap-3">
                        <Panel title="盤中參考" sub="TradingView 報價，依其可用資料">
                            <TradingViewWidget
                                scriptUrl={`${scriptUrl}symbol-info.js`}
                                config={symbolInfoConfig(tvSymbol)}
                                height={180}
                            />
                        </Panel>
                        <Suspense fallback={null}>
                            <Sentiment symbol={symbol} />
                        </Suspense>
                    </div>
                </div>

                <div className="mt-3">
                    <Suspense fallback={null}>
                        <Factors symbol={symbol} />
                    </Suspense>
                </div>
            </>
        );
    }

    // CoinGecko coins (`CG:` prefix) have no TradingView symbol mapping:
    // show the header with live price and a friendly placeholder instead of
    // the TradingView panels. Our own indicator panel uses the candle router.
    if (isCoinGeckoSymbol(symbol)) {
        return (
            <>
                <Suspense fallback={<StockHeaderSkeleton />}>
                    <StockHeader symbol={symbol} />
                </Suspense>
                <Panel title="圖表" sub="加密貨幣">
                    <div className="empty-state py-14">
                        <span className="empty-icon"><CandlestickChart className="size-5" /></span>
                        <h3>加密貨幣圖表即將推出</h3>
                        <p className="max-w-80 text-[13px]">
                            目前支援搜尋、即時報價與下方技術指標；此處尚未提供加密貨幣 K 線圖。
                        </p>
                    </div>
                </Panel>
                <div className="mt-3">
                    <Suspense fallback={null}>
                        <Factors symbol={symbol} />
                    </Suspense>
                </div>
            </>
        );
    }

    const tvSymbol = formatSymbolForTradingView(symbol);

    return (
        <>
            <Suspense fallback={<StockHeaderSkeleton />}>
                <StockHeader symbol={symbol} />
            </Suspense>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
                <div className="flex min-w-0 flex-col gap-3">
                    {isChartEmbeddable(tvSymbol) ? (
                        <Panel title="Chart" sub="Live from TradingView · switch interval and style in the chart">
                            <TradingViewWidget
                                scriptUrl={`${scriptUrl}advanced-chart.js`}
                                config={CANDLE_CHART_WIDGET_CONFIG(tvSymbol)}
                                height={560}
                                allowExpand
                            />
                        </Panel>
                    ) : (
                        // TradingView refuses this exchange's chart in embeds; say so instead of showing its error
                        <Panel title="Chart" sub="Only on TradingView for this exchange">
                            <div className="empty-state py-14">
                                <span className="empty-icon"><CandlestickChart className="size-5" /></span>
                                <h3>Chart not available here</h3>
                                <p className="max-w-80 text-[13px]">
                                    TradingView doesn’t license {tvSymbol.split(':')[0]} charts for other sites. Financials, technicals and the profile below still work.
                                </p>
                                <a href={tradingViewSymbolUrl(tvSymbol)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost mt-2">
                                    Open chart on TradingView
                                </a>
                            </div>
                        </Panel>
                    )}
                    <Panel title="Financials" sub="Income statement, balance sheet and ratios">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}financials.js`}
                            config={COMPANY_FINANCIALS_WIDGET_CONFIG(tvSymbol)}
                            height={500}
                        />
                    </Panel>
                </div>

                <div className="flex min-w-0 flex-col gap-3">
                    <Panel title="Technicals" sub="Oscillators and moving averages, 1h">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}technical-analysis.js`}
                            config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(tvSymbol)}
                            height={400}
                        />
                    </Panel>
                    <Suspense fallback={null}>
                        <Sentiment symbol={symbol} />
                    </Suspense>
                    <Panel title="Profile" sub="What the company does">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}symbol-profile.js`}
                            config={COMPANY_PROFILE_WIDGET_CONFIG(tvSymbol)}
                            height={440}
                        />
                    </Panel>
                </div>
            </div>

            <div className="mt-3">
                <Suspense fallback={null}>
                    <Factors symbol={symbol} />
                </Suspense>
            </div>
        </>
    );
}
