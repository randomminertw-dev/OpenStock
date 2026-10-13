'use client';

import { useState } from 'react';
import { ChevronDown, TrendingUp, TrendingDown, Minus, Copy } from 'lucide-react';
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

export function formatIndicatorCopyText(results: IndicatorResult[]): string {
    return results.map((result) => {
        const value = result.value === null || result.signal === null ? 'N/A' : formatValue(result.value);
        return `${CATEGORY_LABEL[result.category]}｜${result.name}：${value}`;
    }).join('\n');
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
    const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const validCount = results.filter((r) => r.signal !== null).length;

    async function copyValues() {
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(formatIndicatorCopyText(results));
            setCopyStatus('success');
        } catch {
            setCopyStatus('error');
        }
    }

    return (
        <div className="border-t border-line">
            <div className="flex flex-wrap items-center gap-1 px-3 py-1">
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-md py-1 text-left transition-colors hover:bg-hover/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                    aria-expanded={expanded}
                >
                    <span className="text-[13px] font-bold text-foreground">
                        57 項指標明細{' '}
                        <span className="num font-semibold text-faint">
                            ({validCount}/{results.length} 有效)
                        </span>
                    </span>
                    <ChevronDown className={cn('size-4 shrink-0 text-faint transition-transform', expanded && 'rotate-180')} />
                </button>
                <button type="button" onClick={copyValues} aria-label="複製 57 項指標數值"
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:border-gold/50 hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
                    <Copy className="size-3.5" aria-hidden="true" />複製數值
                </button>
            </div>
            {copyStatus !== 'idle' && <p role="status" aria-live="polite" className={cn('px-3 pb-2 text-[11px]', copyStatus === 'success' ? 'text-up' : 'text-warn')}>
                {copyStatus === 'success' ? `已複製 ${results.length} 項指標數值。` : '複製失敗，請確認瀏覽器允許剪貼簿存取。'}
            </p>}
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
