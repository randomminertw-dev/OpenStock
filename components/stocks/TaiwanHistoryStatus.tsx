'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Clock, Database, RefreshCw } from 'lucide-react';
import type { TaiwanHistoryStatus as TaiwanHistoryStatusData } from '@/lib/taiwan/types';
import { getTaiwanHistory, requestTaiwanHistoryAction } from '@/lib/actions/taiwan.actions';

interface TaiwanHistoryStatusProps {
    symbol: string;
    initial: TaiwanHistoryStatusData;
}

export function shouldRefreshOnHistoryTransition(
    prevState: TaiwanHistoryStatusData['state'],
    nextState: TaiwanHistoryStatusData['state']
): boolean {
    const wasActive = prevState === 'running' || prevState === 'queued' || prevState === 'partial';
    return wasActive && nextState === 'ready';
}

export default function TaiwanHistoryStatus({
    symbol,
    initial,
}: TaiwanHistoryStatusProps) {
    let router: ReturnType<typeof useRouter> | null = null;
    try {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        router = useRouter();
    } catch {
        router = null;
    }
    const [status, setStatus] = useState<TaiwanHistoryStatusData>(initial);
    const [isRetrying, setIsRetrying] = useState(false);
    const pollCountRef = useRef(0);
    const prevStatusStateRef = useRef(initial.state);
    const prevCandleCountRef = useRef(initial.candleCount);
    useEffect(() => { setStatus(initial); }, [initial]);

    useEffect(() => {
        if (shouldRefreshOnHistoryTransition(prevStatusStateRef.current, status.state)
            || status.candleCount > prevCandleCountRef.current) {
            router?.refresh();
        }
        prevStatusStateRef.current = status.state;
        prevCandleCountRef.current = status.candleCount;
    }, [status.state, status.candleCount, router]);

    const handleRetry = async () => {
        setIsRetrying(true);
        try {
            const nextStatus = await requestTaiwanHistoryAction(symbol);
            setStatus(nextStatus);
            pollCountRef.current = 0;
        } catch (err) {
            console.error('Failed to trigger Taiwan history sync:', err);
        } finally {
            setIsRetrying(false);
        }
    };

    useEffect(() => {
        // On-demand partial history also progresses without an external job service.
        if ((status.state !== 'running' && status.state !== 'queued' && status.state !== 'partial') || status.reason) {
            return;
        }

        const poll = async () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                return;
            }
            if (pollCountRef.current >= Math.ceil(status.total / 2) + 3) {
                return;
            }

            pollCountRef.current += 1;
            try {
                const res = await getTaiwanHistory(symbol, 800);
                if (res?.status) {
                    setStatus(res.status);
                }
            } catch {
                // ignore poll read errors
            }
        };

        const interval = setInterval(poll, 30_000);
        return () => clearInterval(interval);
    }, [symbol, status.state, status.reason, status.total]);

    useEffect(() => {
        if (status.reason !== 'budget-limit') return;
        const taipeiDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const pausedDay = taipeiDay();
        let pending = false;
        const interval = setInterval(async () => {
            if (pending || taipeiDay() === pausedDay || document.visibilityState !== 'visible') return;
            pending = true;
            try { const result = await getTaiwanHistory(symbol, 800); setStatus(result.status); pollCountRef.current = 0; }
            catch { /* Keep already loaded data while the next day's budget becomes available. */ }
            finally { pending = false; }
        }, 60_000);
        return () => clearInterval(interval);
    }, [symbol, status.reason]);

    if (status.state === 'ready') {
        return null;
    }

    if (status.state === 'disabled') {
        return (
            <div className="card p-3 flex items-center gap-2 text-xs text-faint mb-3">
                <Database className="size-4 shrink-0" />
                <span>台股歷史同步尚未啟用</span>
            </div>
        );
    }

    if (status.state === 'partial') {
        return (
            <div className="card p-3 flex flex-wrap items-center justify-between gap-3 text-xs mb-3">
                <div className="flex items-center gap-2">
                    <Database className="size-4 text-brand shrink-0" />
                    <span>
                        部分歷史資料（已載入 <b className="text-foreground">{status.candleCount}</b> 根 K 線，進度 {status.completed} / {status.total} 批次）
                        {status.reason === 'budget-limit' ? ' · 今日額度已達上限，明日自動續載' : status.reason === 'api-error' ? ' · 官方來源暫時無法更新' : ' · 自動載入中'}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={handleRetry}
                    disabled={isRetrying}
                    className="btn btn-sm btn-ghost flex items-center gap-1.5 text-xs"
                >
                    <RefreshCw className={`size-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                    {isRetrying ? '同步中...' : '手動重試'}
                </button>
            </div>
        );
    }

    if (status.state === 'running' || status.state === 'queued') {
        return (
            <div className="card p-3 flex flex-wrap items-center justify-between gap-3 text-xs mb-3">
                <div className="flex items-center gap-2">
                    <Clock className="size-4 text-brand animate-spin shrink-0" />
                    <span>
                        {status.state === 'queued' ? '歷史資料排隊同步中...' : '歷史資料同步中...'}
                        （已載入 <b className="text-foreground">{status.candleCount}</b> 根 K 線，完成 {status.completed} / {status.total}）
                    </span>
                </div>
            </div>
        );
    }

    if (status.state === 'error') {
        const reasonText =
            status.reason === 'budget-limit'
                ? '已達每日請求配額上限'
                : status.reason === 'missing-config'
                  ? '缺少同步組態'
                  : '上游 API 暫時錯誤';

        return (
            <div className="card p-3 flex flex-wrap items-center justify-between gap-3 text-xs text-destructive mb-3">
                <div className="flex items-center gap-2">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>歷史資料同步失敗（{reasonText}）</span>
                </div>
                <button
                    type="button"
                    onClick={handleRetry}
                    disabled={isRetrying}
                    className="btn btn-sm btn-ghost flex items-center gap-1.5 text-xs text-foreground"
                >
                    <RefreshCw className={`size-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                    {isRetrying ? '重試中...' : '重試'}
                </button>
            </div>
        );
    }

    return null;
}
