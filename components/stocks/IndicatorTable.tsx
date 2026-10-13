'use client';

import { useState } from 'react';
import { ChevronDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATEGORY_LABEL } from '@/lib/indicators/category-labels';
import type { IndicatorResult, Signal } from '@/lib/indicators/types';

const SIGNAL_META: Record<Exclude<Signal, null>, { label: string; symbol: string; className: string; Icon: typeof TrendingUp }> = {
    1: { label: '看漲', symbol: '▲', className: 'text-up', Icon: TrendingUp },
    [-1]: { label: '看跌', symbol: '▼', className: 'text-down', Icon: TrendingDown },
    0: { label: '中立', symbol: '—', className: 'text-faint', Icon: Minus },
};

function formatValue(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return 'N/A';
    const abs = Math.abs(v);
    if (abs >= 1000) return v.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    if (abs >= 100) return v.toFixed(1);
    if (abs >= 1) return v.toFixed(2);
    return v.toFixed(4);
}

function IndicatorRow({ result }: { result: IndicatorResult }) {
    const na = result.value === null || result.signal === null;
    const meta = result.signal !== null ? SIGNAL_META[result.signal] : null;
    const MetaIcon = meta?.Icon;
    return (
        <li className="border-t border-line px-3 py-2.5 first:border-t-0">
            <div className="flex items-center justify-between gap-2">
                <p className="min-w-0">
                    <span className={cn('truncate text-[13px] font-semibold', na ? 'text-faint' : 'text-foreground')}>
                        {result.name}
                    </span>{' '}
                    <span className="text-[11px] text-faint/70">{CATEGORY_LABEL[result.category]}</span>
                </p>
                {na || !meta || !MetaIcon ? (
                    <span className="num shrink-0 text-[12px] font-semibold text-faint/60">N/A</span>
                ) : (
                    <span className={cn('flex shrink-0 items-center gap-1 text-[12.5px] font-bold', meta.className)}>
                        <MetaIcon className="size-3" />
                        <span className="num">{formatValue(result.value)}</span>
                    </span>
                )}
            </div>
            <p className="mt-1 text-[12px] leading-snug text-faint">
                {na ? '資料不足，無法計算' : result.reason}
            </p>
        </li>
    );
}

export default function IndicatorTable({ results }: { results: IndicatorResult[] }) {
    const [expanded, setExpanded] = useState(false);
    const validCount = results.filter((r) => r.signal !== null).length;

    return (
        <div className="border-t border-line">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-hover/50"
                aria-expanded={expanded}
            >
                <span className="text-[13px] font-bold text-foreground">
                    57 項指標明細{' '}
                    <span className="num font-semibold text-faint">
                        ({validCount}/{results.length} 有效)
                    </span>
                </span>
                <ChevronDown className={cn('size-4 text-faint transition-transform', expanded && 'rotate-180')} />
            </button>
            {expanded && (
                <ul className="max-h-96 overflow-y-auto border-t border-line">
                    {results.map((r) => (
                        <IndicatorRow key={r.id} result={r} />
                    ))}
                </ul>
            )}
        </div>
    );
}
