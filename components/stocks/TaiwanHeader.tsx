import React from 'react';
import { Bell, CalendarClock, Gauge, Landmark, MoveVertical } from 'lucide-react';
import WatchlistButton from '@/components/WatchlistButton';
import ChangePill from '@/components/ChangePill';
import PriceFlash from '@/components/PriceFlash';
import type { TaiwanQuote, TaiwanSecurity } from '@/lib/taiwan/types';

export function formatTaiwanPrice(
    price: number | null | undefined,
    currency: string | null | undefined
): string {
    if (price === null || price === undefined) return '—';
    if (!currency || currency.toUpperCase() === 'UNKNOWN') {
        return price.toFixed(2);
    }
    if (currency.toUpperCase() === 'TWD') {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'TWD',
            minimumFractionDigits: 2,
        }).format(price);
    }
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
        }).format(price);
    } catch {
        return `${currency} ${price.toFixed(2)}`;
    }
}

export default function TaiwanHeader({
    security,
    quote,
    symbol,
    isInWatchlist = false,
}: {
    security: TaiwanSecurity | null;
    quote: TaiwanQuote | null;
    symbol: string;
    isInWatchlist?: boolean;
}) {

    const currency = quote?.currency ?? security?.currency ?? null;
    const displayName = security?.name || security?.code || symbol;
    const formattedPrice = formatTaiwanPrice(quote?.price, currency);

    const stats = [
        {
            label: '交易所',
            icon: Landmark,
            value: security?.exchange ?? 'TWSE',
            hint: security?.kind === 'etf' ? 'ETF 基金' : '臺灣證券交易所 / 櫃買中心',
        },
        {
            label: '商品類型',
            icon: Gauge,
            value: security?.kind === 'etf' ? 'ETF' : (security?.kind === 'stock' ? '普通股' : '台股'),
            hint: currency ? `計價幣別: ${currency}` : '幣別未指定',
        },
        {
            label: '上市日期',
            icon: CalendarClock,
            value: security?.listingDate ?? '—',
            hint: '掛牌日期',
        },
        {
            label: '交易狀態',
            icon: MoveVertical,
            value: security?.status === 'suspended' ? '停牌' : (security?.status === 'active' ? '正常交易' : (security?.status ?? '—')),
            hint: quote?.stale ? '收盤資料待更新' : '官方收盤行情',
        },
    ];

    return (
        <section className="hatch">
            <div className="card flex flex-wrap items-center gap-x-6 gap-y-4 p-4">
                <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
                    <span className="logo-well is-empty size-11">{displayName[0] || '台'}</span>
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-bold tracking-[-0.03em]">{displayName}</h1>
                        <p className="mono truncate text-[12.5px] text-faint">
                            {[symbol, security?.exchange, security?.kind === 'etf' ? 'ETF' : '台股']
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                    </div>
                </div>

                <div className="flex items-end gap-3">
                    <PriceFlash value={quote?.price ?? undefined} className="bento-value px-1 text-[32px]">
                        {formattedPrice}
                    </PriceFlash>
                    <div className="flex flex-col items-start gap-1 pb-0.5">
                        <ChangePill value={quote?.changePercent ?? null} />
                        <span className="num text-[12px] text-faint">
                            {quote?.tradingDate ? `${quote.tradingDate} 收盤` : '收盤'}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <WatchlistButton symbol={symbol} company={displayName} isInWatchlist={isInWatchlist} />
                    <span className="pill h-9 px-3" title="Price alerts need a quote source we can check every 5 minutes">
                        <Bell /> Alerts: US stocks and crypto
                    </span>
                </div>
            </div>

            <div className="bento mt-[3px]">
                {stats.map(({ label, icon: Icon, value, hint }) => (
                    <div key={label} className="bento-tile gap-2.5">
                        <div className="bento-head">
                            <span className="bento-ico"><Icon /></span>
                            {label}
                        </div>
                        <p className="num truncate text-[17px] font-bold tracking-[-0.02em]">{value}</p>
                        <p className="text-[12px] text-faint">{hint}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}
