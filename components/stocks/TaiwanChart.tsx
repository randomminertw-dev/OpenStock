'use client';

import React, { useMemo, useState } from 'react';
import { CandlestickChart } from 'lucide-react';
import type { TaiwanBar, TaiwanEvent } from '@/lib/taiwan/types';

interface TaiwanChartProps {
    bars: TaiwanBar[];
    events?: TaiwanEvent[];
}

type Timeframe = '3M' | '1Y' | 'ALL';

export default function TaiwanChart({ bars, events = [] }: TaiwanChartProps) {
    const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    // Filter bars by timeframe
    const visibleBars = useMemo(() => {
        if (!bars || bars.length === 0) return [];
        if (timeframe === '3M') return bars.slice(-63);
        if (timeframe === '1Y') return bars.slice(-252);
        return bars;
    }, [bars, timeframe]);

    // Map events by date
    const eventsByDate = useMemo(() => {
        const map = new Map<string, TaiwanEvent[]>();
        for (const evt of events) {
            const list = map.get(evt.date) || [];
            list.push(evt);
            map.set(evt.date, list);
        }
        return map;
    }, [events]);

    if (!visibleBars || visibleBars.length === 0) {
        return (
            <div className="empty-state py-12 flex flex-col items-center justify-center text-center">
                <span className="empty-icon mb-2">
                    <CandlestickChart className="size-5 text-muted" />
                </span>
                <p className="text-sm text-faint">無歷史 K 線資料</p>
                <div className="mt-3 flex gap-2">
                    {(['3M', '1Y', 'ALL'] as Timeframe[]).map((tf) => (
                        <button
                            key={tf}
                            type="button"
                            onClick={() => setTimeframe(tf)}
                            className={`btn btn-sm ${timeframe === tf ? 'btn-primary' : 'btn-ghost'}`}
                        >
                            {tf === '3M' ? '3 個月' : tf === '1Y' ? '1 年' : '全部'}
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    const activeBar = hoveredIndex !== null && visibleBars[hoveredIndex]
        ? visibleBars[hoveredIndex]
        : visibleBars[visibleBars.length - 1];

    const activeEvents = activeBar ? eventsByDate.get(activeBar.tradingDate) : undefined;

    // Chart dimensions
    const width = 800;
    const height = 420;
    const padding = { top: 20, right: 30, bottom: 40, left: 20 };
    const chartWidth = width - padding.left - padding.right;
    const priceHeight = 250;
    const volumeGap = 15;
    const volumeHeight = 75;
    const priceTop = padding.top;
    const volumeTop = priceTop + priceHeight + volumeGap;

    // Price scaling
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVolume = 1;

    for (const b of visibleBars) {
        if (b.l < minPrice) minPrice = b.l;
        if (b.h > maxPrice) maxPrice = b.h;
        if (b.v > maxVolume) maxVolume = b.v;
    }

    if (!Number.isFinite(minPrice)) minPrice = 0;
    if (!Number.isFinite(maxPrice) || maxPrice === minPrice) {
        maxPrice = minPrice + (minPrice > 0 ? minPrice * 0.1 : 10);
        minPrice = Math.max(0, minPrice - (minPrice > 0 ? minPrice * 0.05 : 0));
    }

    const priceRange = maxPrice - minPrice || 1;
    const yPrice = (p: number) =>
        priceTop + priceHeight - ((p - minPrice) / priceRange) * priceHeight;
    const yVolume = (v: number) =>
        volumeTop + volumeHeight - (v / maxVolume) * volumeHeight;

    const candlePitch = chartWidth / visibleBars.length;
    const candleWidth = Math.max(1, Math.min(10, candlePitch * 0.7));

    return (
        <div className="flex flex-col gap-3 select-none">
            {/* Header / Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 text-xs">
                {/* OHLCV Summary */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mono text-faint">
                    <span>
                        開 <b className="text-foreground font-semibold">{activeBar.o}</b>
                    </span>
                    <span>
                        高 <b className="text-foreground font-semibold">{activeBar.h}</b>
                    </span>
                    <span>
                        低 <b className="text-foreground font-semibold">{activeBar.l}</b>
                    </span>
                    <span>
                        收 <b className="text-foreground font-semibold">{activeBar.c}</b>
                    </span>
                    <span>
                        成交量 <b className="text-foreground font-semibold">{activeBar.v.toLocaleString()}</b> 股
                    </span>
                    {activeEvents && activeEvents.length > 0 && (
                        <span className="text-warn font-semibold">
                            ★ {activeEvents.map((e) => e.title).join(' / ')}
                        </span>
                    )}
                </div>

                {/* Timeframe selector */}
                <div className="flex items-center gap-1.5 ml-auto">
                    {(['3M', '1Y', 'ALL'] as Timeframe[]).map((tf) => (
                        <button
                            key={tf}
                            type="button"
                            onClick={() => setTimeframe(tf)}
                            className={`btn btn-sm text-xs px-2.5 py-1 ${timeframe === tf ? 'btn-primary' : 'btn-ghost'}`}
                        >
                            {tf === '3M' ? '3 個月' : tf === '1Y' ? '1 年' : '全部'}
                        </button>
                    ))}
                </div>
            </div>

            {/* SVG Candlestick & Volume Chart */}
            <div className="relative w-full overflow-hidden rounded-lg bg-card/40 p-1">
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    className="w-full h-auto block"
                    onMouseLeave={() => setHoveredIndex(null)}
                >
                    <defs>
                        <clipPath id="chartArea">
                            <rect
                                x={padding.left}
                                y={padding.top}
                                width={chartWidth}
                                height={priceHeight + volumeGap + volumeHeight}
                            />
                        </clipPath>
                    </defs>

                    {/* Grid Lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                        const y = priceTop + priceHeight * ratio;
                        const priceVal = maxPrice - priceRange * ratio;
                        return (
                            <g key={ratio}>
                                <line
                                    x1={padding.left}
                                    y1={y}
                                    x2={padding.left + chartWidth}
                                    y2={y}
                                    stroke="var(--line, #334155)"
                                    strokeDasharray="3 3"
                                    strokeOpacity={0.4}
                                />
                                <text
                                    x={padding.left + chartWidth + 5}
                                    y={y + 3}
                                    fontSize="10"
                                    fill="var(--faint, #94a3b8)"
                                    textAnchor="start"
                                    className="mono"
                                >
                                    {priceVal.toFixed(1)}
                                </text>
                            </g>
                        );
                    })}

                    {/* Volume baseline */}
                    <line
                        x1={padding.left}
                        y1={volumeTop + volumeHeight}
                        x2={padding.left + chartWidth}
                        y2={volumeTop + volumeHeight}
                        stroke="var(--line, #334155)"
                        strokeOpacity={0.5}
                    />

                    {/* Bars & Candles */}
                    {visibleBars.map((bar, idx) => {
                        const xCenter = padding.left + (idx + 0.5) * candlePitch;
                        const isUp = bar.c >= bar.o;
                        const candleColor = isUp ? 'var(--up, #22c55e)' : 'var(--down, #ef4444)';
                        const volumeFill = isUp ? 'var(--up, #22c55e)' : 'var(--down, #ef4444)';

                        const yO = yPrice(bar.o);
                        const yC = yPrice(bar.c);
                        const yH = yPrice(bar.h);
                        const yL = yPrice(bar.l);

                        const bodyTop = Math.min(yO, yC);
                        const bodyHeight = Math.max(1.5, Math.abs(yC - yO));

                        const vTop = yVolume(bar.v);
                        const vHeight = Math.max(1, volumeTop + volumeHeight - vTop);

                        const dayEvents = eventsByDate.get(bar.tradingDate);

                        return (
                            <g
                                key={bar.tradingDate + idx}
                                onMouseEnter={() => setHoveredIndex(idx)}
                                className="cursor-crosshair"
                            >
                                {/* Hit area */}
                                <rect
                                    x={padding.left + idx * candlePitch}
                                    y={padding.top}
                                    width={candlePitch}
                                    height={height - padding.top - padding.bottom}
                                    fill="transparent"
                                />

                                {/* Wick (High-Low) */}
                                <line
                                    x1={xCenter}
                                    y1={yH}
                                    x2={xCenter}
                                    y2={yL}
                                    stroke={candleColor}
                                    strokeWidth={1}
                                />

                                {/* Candle Body (Open-Close) */}
                                <rect
                                    x={xCenter - candleWidth / 2}
                                    y={bodyTop}
                                    width={candleWidth}
                                    height={bodyHeight}
                                    fill={candleColor}
                                />

                                {/* Volume Bar */}
                                <rect
                                    x={xCenter - candleWidth / 2}
                                    y={vTop}
                                    width={candleWidth}
                                    height={vHeight}
                                    fill={volumeFill}
                                    opacity={0.65}
                                />

                                {/* Event Marker */}
                                {dayEvents && dayEvents.length > 0 && (
                                    <circle
                                        cx={xCenter}
                                        cy={Math.max(padding.top + 5, yH - 7)}
                                        r={3.5}
                                        fill="var(--warn, #eab308)"
                                        stroke="var(--canvas, #0f172a)"
                                        strokeWidth={1}
                                    />
                                )}
                            </g>
                        );
                    })}

                    {/* X-axis date labels */}
                    {visibleBars.length > 0 && (
                        <>
                            <text
                                x={padding.left}
                                y={height - 12}
                                fontSize="10"
                                fill="var(--faint, #94a3b8)"
                                className="mono"
                            >
                                {visibleBars[0].tradingDate}
                            </text>
                            {visibleBars.length > 1 && (
                                <text
                                    x={padding.left + chartWidth}
                                    y={height - 12}
                                    fontSize="10"
                                    fill="var(--faint, #94a3b8)"
                                    textAnchor="end"
                                    className="mono"
                                >
                                    {visibleBars[visibleBars.length - 1].tradingDate}
                                </text>
                            )}
                        </>
                    )}
                </svg>
            </div>

            {/* Unadjusted price notice */}
            <p className="text-[12px] text-faint">
                ※ 價格為官方未調整價格（除權息與分割不回溯調整歷史 K 線）
            </p>
        </div>
    );
}
