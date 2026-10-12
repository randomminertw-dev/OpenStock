import { TrendingUp, TrendingDown, Minus, Scale } from 'lucide-react';
import { getFactorAssessment } from '@/lib/actions/factors.actions';
import type { Factor, FactorVerdict } from '@/lib/factors/scoring';
import { cn } from '@/lib/utils';

const VERDICT_META: Record<FactorVerdict, { label: string; pill: string; Icon: typeof TrendingUp }> = {
    bullish: { label: '偏多', pill: 'pill is-up', Icon: TrendingUp },
    bearish: { label: '偏空', pill: 'pill is-down', Icon: TrendingDown },
    neutral: { label: '中性', pill: 'pill', Icon: Minus },
};

function FactorRow({ factor }: { factor: Factor }) {
    const up = factor.direction === 'bullish';
    return (
        <li className="border-t border-line px-3 py-2.5 first:border-t-0">
            <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[13px] font-semibold text-foreground">{factor.name}</p>
                <span className={cn('num shrink-0 text-[12.5px] font-bold', up ? 'text-up' : 'text-down')}>
                    {up ? '+' : ''}{factor.score}
                </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                <div
                    className={cn('h-full rounded-full', up ? 'bg-up' : 'bg-down')}
                    style={{ width: `${Math.min(100, Math.abs(factor.score))}%` }}
                />
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-faint">{factor.detail}</p>
            <p className="mt-0.5 text-[11px] text-faint/70">來源：{factor.source}</p>
        </li>
    );
}

function FactorColumn({
    title,
    Icon,
    iconClass,
    factors,
    emptyText,
}: {
    title: string;
    Icon: typeof TrendingUp;
    iconClass: string;
    factors: Factor[];
    emptyText: string;
}) {
    return (
        <div className="min-w-0 rounded-xl border border-line">
            <div className="flex items-center gap-1.5 px-3 py-2">
                <Icon className={cn('size-4', iconClass)} />
                <h3 className="text-[13px] font-bold text-foreground">
                    {title} <span className="num font-semibold text-faint">({factors.length})</span>
                </h3>
            </div>
            {factors.length > 0 ? (
                <ul>
                    {factors.map((f) => (
                        <FactorRow key={f.id} factor={f} />
                    ))}
                </ul>
            ) : (
                <p className="border-t border-line px-3 py-3 text-[12px] text-faint">{emptyText}</p>
            )}
        </div>
    );
}

export default async function StockFactorsPanel({ symbol }: { symbol: string }) {
    const assessment = await getFactorAssessment(symbol);
    if (!assessment) return null;

    const { factors, compositeScore, verdict, updatedAt } = assessment;
    if (factors.length === 0) {
        return (
            <div className="empty-state py-10">
                <span className="empty-icon"><Scale className="size-5" /></span>
                <h3>暫無因素資料</h3>
                <p className="max-w-80 text-[13px]">目前沒有足夠的技術線圖或新聞可以評分，稍後再回來看看。</p>
            </div>
        );
    }

    const bullish = factors.filter((f) => f.direction === 'bullish');
    const bearish = factors.filter((f) => f.direction === 'bearish');
    const neutral = factors.filter((f) => f.direction === 'neutral');
    const meta = VERDICT_META[verdict];
    const markerLeft = `${(compositeScore + 100) / 2}%`;

    return (
        <div className="flex flex-col">
            {/* Composite gauge */}
            <div className="px-3 pb-1 pt-3">
                <div className="flex items-center justify-between gap-2">
                    <p className="kicker">綜合評分</p>
                    <span className={cn(meta.pill, 'gap-1')}>
                        <meta.Icon className="size-3" />
                        {meta.label}
                    </span>
                </div>
                <p className="num mt-1 text-[28px] font-bold leading-none text-foreground">
                    {compositeScore > 0 ? '+' : ''}{compositeScore}
                </p>
                <div
                    className="relative mt-2.5 h-2 rounded-full"
                    style={{ background: 'linear-gradient(to right, var(--down), var(--line) 50%, var(--up))' }}
                    role="img"
                    aria-label={`綜合評分 ${compositeScore}`}
                >
                    <div
                        className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
                        style={{ left: markerLeft }}
                    />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-faint">
                    <span>-100 偏空</span>
                    <span>+100 偏多</span>
                </div>
            </div>

            {/* Bullish vs bearish columns */}
            <div className="grid gap-2.5 p-3 sm:grid-cols-2">
                <FactorColumn
                    title="偏多因素"
                    Icon={TrendingUp}
                    iconClass="text-up"
                    factors={bullish}
                    emptyText="目前沒有偏多訊號。"
                />
                <FactorColumn
                    title="偏空因素"
                    Icon={TrendingDown}
                    iconClass="text-down"
                    factors={bearish}
                    emptyText="目前沒有偏空訊號。"
                />
            </div>

            {neutral.length > 0 && (
                <p className="border-t border-line px-3 py-2 text-[12px] text-faint">
                    中性：{neutral.map((f) => f.name).join('、')}
                </p>
            )}

            <p className="border-t border-line px-3 py-2.5 text-[11.5px] leading-relaxed text-faint">
                僅供參考，不構成投資建議。評分來自技術指標與新聞關鍵字的啟發式規則。
                <span className="num">更新於 {new Date(updatedAt).toLocaleString('zh-TW', { hour12: false })}</span>
            </p>
        </div>
    );
}
