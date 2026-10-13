"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Search, Star } from "lucide-react";
import CreateAlertModal from "./CreateAlertModal";
import WatchlistButton from "@/components/WatchlistButton";
import ChangePill from "@/components/ChangePill";
import PriceFlash from "@/components/PriceFlash";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { SearchButton } from "@/components/SearchCommand";
import { formatNumber, formatPrice } from "@/lib/utils";
import { hasFinnhubQuotes } from "@/lib/markets";
import { TAIWAN_CODE_REGEX } from "@/lib/taiwan/symbols";
import type { getWatchlistData } from "@/lib/actions/finnhub.actions";

type Row = Awaited<ReturnType<typeof getWatchlistData>>[number];
const SUGGESTIONS = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN'];

export function isTaiwanWatchlistSymbol(symbol: string): boolean {
    if (!symbol) return false;
    const upper = symbol.toUpperCase();
    return (
        upper.startsWith('TWSE:') ||
        upper.startsWith('TPEX:') ||
        upper.endsWith('.TW') ||
        upper.endsWith('.TWO') ||
        TAIWAN_CODE_REGEX.test(upper)
    );
}

export function formatWatchlistPrice(
    price: number | null | undefined,
    currency: string | null | undefined
): string {
    if (price === null || price === undefined) return '—';
    if (!currency) {
        return price.toFixed(2);
    }
    return formatPrice(price, currency);
}

export function formatWatchlistChange(
    change: number | null | undefined,
    price: number | null | undefined
): string {
    if (price === null || price === undefined || change === null || change === undefined) {
        return '—';
    }
    if (change === 0) {
        return '0.00';
    }
    return `${change > 0 ? '+' : ''}${change.toFixed(2)}`;
}

export default function WatchlistTable({ initialRows }: { initialRows: Row[] }) {
    const [baseRows, setBaseRows] = useState(initialRows);

    // Taiwan stocks are closed-market daily data; only poll live quotes for US / Crypto
    const liveSymbols = baseRows
        .filter((r) => !isTaiwanWatchlistSymbol(r.symbol))
        .map((r) => r.symbol);
    const live = useLiveQuotes(liveSymbols);

    // Server re-renders (after add/remove) replace the local copy
    useEffect(() => setBaseRows(initialRows), [initialRows]);

    const rows = baseRows.map((r) => {
        if (isTaiwanWatchlistSymbol(r.symbol)) {
            return r;
        }
        const q = live[r.symbol];
        return q?.c ? { ...r, price: q.c, change: q.d ?? r.change, changePercent: q.dp ?? r.changePercent } : r;
    });

    if (rows.length === 0) {
        return (
            <div className="empty-state">
                <span className="empty-icon"><Star className="size-5" /></span>
                <h3>Nothing on your watchlist yet</h3>
                <p className="max-w-sm">Search for a company and star it to track its price here and set alerts.</p>
                <SearchButton className="btn btn-primary mt-3"><Search /> Search stocks</SearchButton>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                    {SUGGESTIONS.map((s) => (
                        <Link key={s} href={`/stocks/${s}`} className="pill mono h-7 px-3 hover:bg-hover hover:text-foreground">{s}</Link>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto rounded-[14px]">
            <table className="data-table">
                <thead>
                    <tr>
                        <th>Company</th>
                        <th className="is-num">Price</th>
                        <th className="is-num">Today / 收盤</th>
                        <th className="is-num">Change</th>
                        <th className="is-num">Market cap</th>
                        <th className="w-[88px]"><span className="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const isTaiwan = isTaiwanWatchlistSymbol(row.symbol);
                        return (
                            <tr key={row.symbol}>
                                <td className="max-w-[320px]">
                                    <Link href={`/stocks/${row.symbol}`} className="group flex items-center gap-3">
                                        {row.logo ? (
                                            <span className="logo-well"><img src={row.logo} alt="" className="size-full object-contain p-1" /></span>
                                        ) : (
                                            <span className="logo-well is-empty">{row.symbol[0]}</span>
                                        )}
                                        <span className="min-w-0">
                                            <span className="block truncate font-semibold text-foreground group-hover:text-brand-ink transition-colors" title={row.name}>{row.name}</span>
                                            <span className="mono block text-[12px] text-faint">{row.symbol}</span>
                                        </span>
                                    </Link>
                                </td>
                                <td className="is-num font-semibold text-foreground">
                                    <PriceFlash value={row.price} className="px-1">
                                        {formatWatchlistPrice(row.price, row.currency)}
                                    </PriceFlash>
                                </td>
                                <td className="is-num">
                                    <ChangePill value={row.price !== null && row.price !== undefined ? row.changePercent : null} />
                                    {isTaiwan && (
                                        <span className="block text-[11px] text-faint">
                                            {row.tradingDate ? `${row.tradingDate} 收盤` : '收盤'}
                                        </span>
                                    )}
                                </td>
                                <td className="is-num text-muted-foreground">
                                    {formatWatchlistChange(row.change, row.price)}
                                </td>
                                <td className="is-num text-muted-foreground">{row.marketCap ? formatNumber(row.marketCap) : '—'}</td>
                                <td>
                                    <div className="flex items-center justify-end gap-1">
                                        {hasFinnhubQuotes(row.symbol) ? (
                                            <CreateAlertModal symbol={row.symbol} currentPrice={row.price ?? 0} currency={row.currency || 'USD'}>
                                                <button type="button" className="icon-btn" title={`Set a price alert for ${row.symbol}`} aria-label={`Set a price alert for ${row.symbol}`}>
                                                    <Bell />
                                                </button>
                                            </CreateAlertModal>
                                        ) : (
                                            <span className="icon-btn opacity-40" title="Alerts are available for US stocks and crypto"><Bell /></span>
                                        )}
                                        <WatchlistButton
                                            symbol={row.symbol}
                                            company={row.name}
                                            isInWatchlist
                                            variant="icon"
                                            onWatchlistChange={(sym, added) => {
                                                if (!added) setBaseRows((current) => current.filter((r) => r.symbol !== sym));
                                            }}
                                        />
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
