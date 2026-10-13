import { TrendingUp, TrendingDown, Minus, Scale, Newspaper, ChevronDown } from 'lucide-react';
import { getFourFactorAssessmentWithReason, getIndicatorAssessmentWithReason, getPeriodAssessment } from '@/lib/actions/indicators.actions';
import { getFactorPreference } from '@/lib/actions/factor-preferences.actions';
import { defaultFactorPreference, marketForSymbol } from '@/lib/indicators/factor-periods';
import { getNews } from '@/lib/actions/finnhub.actions';
import { scoreNewsSentiment } from '@/lib/factors/scoring';
import { cn } from '@/lib/utils';
import IndicatorTable, { CATEGORY_LABEL } from './IndicatorTable';
import FactorSettings from './FactorSettings';
import PeriodExplorer from './PeriodExplorer';
import type { Category, IDSResult, IndicatorResult } from '@/lib/indicators/types';
import type { IDSPeriodResult } from '@/lib/indicators/ids';

const DIRECTION_META: Record<IDSResult['direction'], { label: string; symbol: string; pill: string; text: string; Icon: typeof TrendingUp }> = {
    bullish: { label: '看漲', symbol: '▲', pill: 'pill is-up', text: 'text-up', Icon: TrendingUp },
    bearish: { label: '看跌', symbol: '▼', pill: 'pill is-down', text: 'text-down', Icon: TrendingDown },
    neutral: { label: '中性', symbol: '—', pill: 'pill', text: 'text-faint', Icon: Minus },
};

const CATEGORIES: Category[] = ['trend', 'momentum', 'volatility', 'volume', 'support', 'breadth'];

// v1.1 IDS-Period 的四個指標（與 PeriodExplorer 頁籤一致）。
const PERIOD_IDS = ['RSI', 'ADX_DMI', 'CMF', 'ATR'] as const;
const PERIOD_LABEL: Record<(typeof PERIOD_IDS)[number], string> = {
    RSI: 'RSI',
    ADX_DMI: 'ADX/DMI',
    CMF: 'CMF',
    ATR: 'ATR%',
};

function fmtPct(v: number | null, digits = 1): string {
    if (v === null || !Number.isFinite(v)) return 'N/A';
    return `${v.toFixed(digits)}%`;
}

function ResultCard({ ids }: { ids: IDSResult }) {
    const meta = DIRECTION_META[ids.direction];
    return (
        <div className="px-3 pb-1 pt-3">
            <div className="flex items-center justify-between gap-2">
                <p className="kicker">技術投票方向</p>
                <span className={cn(meta.pill, 'gap-1')}>
                    <meta.Icon className="size-3" />
                    {meta.symbol} {meta.label}
                </span>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
                <div>
                    <p className="text-[11px] text-faint">IDS 分歧分數</p>
                    <p className="num mt-0.5 text-[24px] font-bold leading-none text-foreground">
                        {fmtPct(ids.idsPct)}
                    </p>
                </div>
                <div>
                    <p className="text-[11px] text-faint">共識度</p>
                    <p className="num mt-0.5 text-[24px] font-bold leading-none text-foreground">
                        {fmtPct(ids.consensusPct)}
                    </p>
                </div>
                <div>
                    <p className="text-[11px] text-faint">覆蓋率</p>
                    <p className="num mt-0.5 text-[24px] font-bold leading-none text-foreground">
                        {fmtPct(ids.coveragePct)}
                    </p>
                </div>
            </div>

            {/* Bullish / bearish / neutral stack bar */}
            <div className="mt-3" role="img" aria-label={`看漲 ${fmtPct(ids.upPct)}，看跌 ${fmtPct(ids.downPct)}，中立 ${fmtPct(ids.neutralPct)}`}>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-up" style={{ width: `${ids.upPct ?? 0}%` }} />
                    <div className="h-full bg-down" style={{ width: `${ids.downPct ?? 0}%` }} />
                    <div className="h-full bg-hover" style={{ width: `${ids.neutralPct ?? 0}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[11.5px]">
                    <span className="text-up">▲ 看漲 <span className="num font-semibold">{fmtPct(ids.upPct)}</span></span>
                    <span className="text-down">▼ 看跌 <span className="num font-semibold">{fmtPct(ids.downPct)}</span></span>
                    <span className="text-faint">— 中立 <span className="num font-semibold">{fmtPct(ids.neutralPct)}</span></span>
                </div>
            </div>

            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
                等權重技術投票，非 ML 預測。IDS 越高代表指標間分歧越大。
                {ids.entropyPct !== null && (
                    <span className="num"> 方向熵 {fmtPct(ids.entropyPct)}</span>
                )}
            </p>
        </div>
    );
}

function CategoryOverview({ results }: { results: IndicatorResult[] }) {
    return (
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
            {CATEGORIES.map((cat) => {
                const items = results.filter((r) => r.category === cat);
                const valid = items.filter((r) => r.signal !== null);
                const up = valid.filter((r) => r.signal === 1).length;
                const down = valid.filter((r) => r.signal === -1).length;
                const catDirection = up > down ? 'bullish' : down > up ? 'bearish' : 'neutral';
                const meta = DIRECTION_META[catDirection];
                return (
                    <div key={cat} className="rounded-xl border border-line px-3 py-2">
                        <p className="text-[12px] font-bold text-foreground">{CATEGORY_LABEL[cat]}</p>
                        <p className={cn('mt-1 flex items-center gap-1 text-[13px] font-bold', meta.text)}>
                            <meta.Icon className="size-3.5" />
                            {meta.label}
                            <span className="num ml-auto text-[11px] font-semibold text-faint">
                                {valid.length}/{items.length}
                            </span>
                        </p>
                    </div>
                );
            })}
        </div>
    );
}

async function NewsSentimentCard({ symbol }: { symbol: string }) {
    let articles: { headline?: string; summary?: string }[] = [];
    try {
        articles = await getNews([symbol]);
    } catch {
        return null;
    }
    const factors = scoreNewsSentiment(articles);
    if (factors.length === 0) return null;
    const f = factors[0];
    const up = f.direction === 'bullish';
    const down = f.direction === 'bearish';
    return (
        <div className="border-t border-line px-3 py-2.5">
            <div className="flex items-center gap-1.5">
                <Newspaper className="size-4 text-faint" />
                <h3 className="text-[13px] font-bold text-foreground">新聞情緒</h3>
                <span className={cn(
                    'num ml-auto text-[12.5px] font-bold',
                    up ? 'text-up' : down ? 'text-down' : 'text-faint',
                )}>
                    {f.score > 0 ? '+' : ''}{f.score}
                </span>
            </div>
            <p className="mt-1 text-[12px] leading-snug text-faint">{f.detail}</p>
            <p className="mt-0.5 text-[11px] text-faint/70">來源：{f.source}（獨立於技術投票）</p>
        </div>
    );
}

/** 固定日 K 的兩層 IDS；可設定的 IDS-Factor 隨四因素更新。 */
function MultiLevelIds({
    ids,
    idsPeriod,
}: {
    ids: IDSResult | null;
    idsPeriod: Record<string, IDSPeriodResult> | null;
}) {
    return (
        <div className="border-t border-line px-3 py-2.5">
            <p className="kicker">三層分歧分數 IDS</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-faint">
                各層獨立解讀，不合成單一信心分數
            </p>
            <div className={`mt-2 grid gap-2 ${ids && idsPeriod ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {idsPeriod && <div className="rounded-xl border border-line px-2.5 py-2">
                    <p className="text-[11px] font-bold text-foreground">IDS-Period</p>
                    <p className="text-[10.5px] text-faint">期間內分歧</p>
                    <ul className="mt-1.5 space-y-1">
                        {PERIOD_IDS.map((id) => (
                            <li key={id} className="flex items-center justify-between gap-1 text-[11px]">
                                <span className="text-faint">{PERIOD_LABEL[id]}</span>
                                <span className="num font-bold text-foreground">
                                    {fmtPct(idsPeriod[id]?.idsPct ?? null)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>}
                {ids && <div className="rounded-xl border border-line px-2.5 py-2">
                    <p className="text-[11px] font-bold text-foreground">IDS-Indicator</p>
                    <p className="text-[10.5px] text-faint">57 指標分歧</p>
                    <p className="num mt-1.5 text-[22px] font-bold leading-none text-foreground">
                        {fmtPct(ids.idsPct)}
                    </p>
                </div>}
            </div>
        </div>
    );
}

export default async function IndicatorDashboard({ symbol }: { symbol: string }) {
    const market = marketForSymbol(symbol);
    let preferenceResult: Awaited<ReturnType<typeof getFactorPreference>> = null;
    if (market) {
        try {
            preferenceResult = await getFactorPreference(symbol);
        } catch {
            preferenceResult = { preference: defaultFactorPreference(market), readError: true, saved: false };
        }
    }
    const [{ assessment, reason, candleCount }, factorResponse, periodAssessment] = await Promise.all([
        getIndicatorAssessmentWithReason(symbol),
        getFourFactorAssessmentWithReason(symbol, preferenceResult?.preference ?? defaultFactorPreference('us')),
        getPeriodAssessment(symbol),
    ]);
    const messages = {
            'api-error': { title: '行情服務暫時無法使用', message: '歷史行情讀取失敗，請稍後重新整理再試。' },
            'missing-config': { title: '行情來源設定缺失', message: '歷史行情服務尚未設定完成，或憑證與權限需要確認，請聯絡管理者。' },
            'unsupported-symbol': { title: '尚未支援此標的', message: '目前的歷史行情來源無法辨識或支援此標的。' },
            'no-data': { title: '查無歷史資料', message: '行情來源未提供此標的的日 K 線資料。' },
            'insufficient-data': { title: '資料不足', message: `目前取得 ${candleCount} 根有效日 K 線，至少需要 60 根才能開始計算技術指標。` },
        };
    const voteFailure = !assessment ? (() => {
        const { title, message } = messages[reason ?? 'api-error'];
        return <div className="empty-state py-10">
                <span className="empty-icon"><Scale className="size-5" /></span>
                <h3>{title}</h3>
                <p className="max-w-80 text-[13px]">
                    {message}
                </p>
            </div>;
    })() : null;

    const { results, ids, asof, source } = assessment ?? {};
    const sourceNames = { alpaca: 'Alpaca', binance: 'Binance', finmind: 'FinMind', finnhub: 'Finnhub' };
    const dataDate = asof ? new Date(asof).toLocaleDateString('sv-SE', { timeZone: source?.timeZone ?? 'UTC' }) : null;

    return (
        <div className="flex flex-col">
            {voteFailure}
            {assessment && ids && results && (
                <>
                    <ResultCard ids={ids} />
                    <CategoryOverview results={results} />
                    <IndicatorTable results={results} />
                </>
            )}
            <FactorSettings key={symbol} symbol={symbol} initialPreference={preferenceResult?.preference ?? null}
                initialResponse={factorResponse} readError={preferenceResult?.readError ?? false}
                initialSaved={preferenceResult?.saved ?? false} />
            {(ids || periodAssessment) && <MultiLevelIds ids={ids ?? null} idsPeriod={periodAssessment?.idsPeriod ?? null} />}
            {periodAssessment && (
                <>
                    <details className="group border-t border-line">
                        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-hover/50 [&::-webkit-details-marker]:hidden">
                            <span className="text-[13px] font-bold text-foreground">期間探索</span>
                            <ChevronDown className="size-4 text-faint transition-transform group-open:rotate-180" />
                        </summary>
                        <PeriodExplorer variants={periodAssessment.variants} />
                    </details>
                </>
            )}
            <NewsSentimentCard symbol={symbol} />
            <p className="border-t border-line px-3 py-2.5 text-[11.5px] leading-relaxed text-faint">
                技術指標投票僅供參考，不構成投資建議。
                {dataDate && <span className="num">資料日期 {dataDate}</span>}
                {source && (
                    <span> · {sourceNames[source.provider]} · {source.symbol}
                        {source.priceBasis === 'unadjusted' ? ' · 盤後日 K（未還原股價）' : ' · 日 K'}
                    </span>
                )}
            </p>
        </div>
    );
}
