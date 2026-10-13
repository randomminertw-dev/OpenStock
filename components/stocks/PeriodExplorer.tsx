'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Signal } from '@/lib/indicators/types';
import type { VariantIndicatorId, VariantResult } from '@/lib/indicators/variants';

const SIGNAL_META: Record<Exclude<Signal, null>, { label: string; symbol: string; className: string; Icon: typeof TrendingUp }> = {
    1: { label: '看漲', symbol: '▲', className: 'text-up', Icon: TrendingUp },
    [-1]: { label: '看跌', symbol: '▼', className: 'text-down', Icon: TrendingDown },
    0: { label: '中立', symbol: '—', className: 'text-faint', Icon: Minus },
};

const TABS: readonly VariantIndicatorId[] = ['RSI', 'ADX_DMI', 'CMF', 'ATR'] as const;

const INDICATOR_LABEL: Record<VariantIndicatorId, string> = {
    RSI: 'RSI',
    ADX_DMI: 'ADX/DMI',
    CMF: 'CMF',
    ATR: 'ATR',
};

const PERIODS: readonly number[] = [7, 14, 20, 21, 28];

const DEFAULT_PERIOD = 14;

function formatValue(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return 'N/A';
    const abs = Math.abs(v);
    if (abs >= 1000) return v.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    if (abs >= 100) return v.toFixed(1);
    if (abs >= 1) return v.toFixed(2);
    return v.toFixed(4);
}

export default function PeriodExplorer({ variants }: { variants: Record<string, VariantResult[]> }) {
    const [tab, setTab] = useState<VariantIndicatorId>('RSI');
    const [period, setPeriod] = useState<number>(DEFAULT_PERIOD);

    const rows = [...(variants[tab] ?? [])].sort((a, b) => a.n - b.n);

    return (
        <div className="border-t border-line">
            {/* 免責標示 */}
            <p className="px-3 pt-3 text-[11px] leading-snug text-faint">
                手動選擇／未經樣本外驗證。期間為人工指定、僅供觀察，不代表最佳參數，亦非預測建議。
            </p>

            {/* 指標頁籤 */}
            <div className="flex gap-1 px-3 pt-2" role="tablist" aria-label="指標">
                {TABS.map((id) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                        className={cn(
                            'rounded-md px-3 py-1.5 text-[12.5px] font-bold transition-colors',
                            tab === id
                                ? 'bg-gold/15 text-gold'
                                : 'text-faint hover:bg-hover/50 hover:text-foreground'
                        )}
                    >
                        {INDICATOR_LABEL[id]}
                    </button>
                ))}
            </div>

            {/* 期間 chip */}
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5" aria-label="期間選擇">
                {PERIODS.map((n) => (
                    <button
                        key={n}
                        type="button"
                        onClick={() => setPeriod(n)}
                        aria-pressed={period === n}
                        className={cn(
                            'num rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
                            period === n
                                ? 'border-gold bg-gold/15 text-gold'
                                : 'border-line text-faint hover:border-gold/50 hover:text-foreground'
                        )}
                    >
                        n={n}
                    </button>
                ))}
            </div>

            {/* 比較表 */}
            <ul className="mt-2 px-3 pb-3">
                <li className="flex items-center justify-between border-b border-line pb-1.5 text-[11px] font-semibold text-faint">
                    <span>期間</span>
                    <span className="flex items-center gap-6">
                        <span className="num">數值</span>
                        <span className="w-14 text-right">方向</span>
                    </span>
                </li>
                {rows.map((v) => {
                    const na = v.value === null || v.signal === null;
                    const meta = v.signal !== null ? SIGNAL_META[v.signal] : null;
                    const MetaIcon = meta?.Icon;
                    const selected = v.n === period;
                    return (
                        <li
                            key={v.variantId}
                            className={cn(
                                'flex items-center justify-between border-b border-line/60 py-2 last:border-b-0',
                                selected && 'rounded-md bg-gold/10 px-2 -mx-2'
                            )}
                        >
                            <span className={cn('num text-[12.5px] font-bold', selected ? 'text-gold' : 'text-foreground')}>
                                n={v.n}
                            </span>
                            <span className="flex items-center gap-6">
                                <span className={cn('num text-[12.5px] font-semibold', na ? 'text-faint/60' : 'text-foreground')}>
                                    {formatValue(v.value)}
                                </span>
                                <span className="w-14 text-right">
                                    {na || !meta || !MetaIcon ? (
                                        <span className="text-[12px] font-semibold text-faint/60">N/A</span>
                                    ) : (
                                        <span className={cn('inline-flex items-center gap-1 text-[12px] font-bold', meta.className)}>
                                            <MetaIcon className="size-3" />
                                            {meta.label}
                                        </span>
                                    )}
                                </span>
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
