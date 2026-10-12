import { isInternationalSymbol } from '@/lib/utils';

export type CandleMarket =
    | { kind: 'binance' | 'coingecko' | 'taiwan' | 'us' | 'international'; symbol: string }
    | { kind: 'unsupported'; symbol: string };

export function candleMarket(value: string): CandleMarket {
    const symbol = (value || '').trim().toUpperCase();
    if (symbol.startsWith('BINANCE:')) {
        const pair = symbol.slice(8);
        return { kind: /^[A-Z0-9]{4,30}$/.test(pair) ? 'binance' : 'unsupported', symbol: pair };
    }
    if (symbol.startsWith('CG:')) {
        const id = symbol.slice(3).toLowerCase();
        return { kind: /^[a-z0-9_-]+$/.test(id) ? 'coingecko' : 'unsupported', symbol: id };
    }
    const taiwan = symbol.match(/^(?:TWSE:|TPEX:)([0-9][A-Z0-9]{3,7})$/)
        ?? symbol.match(/^([0-9][A-Z0-9]{3,7})\.(?:TW|TWO)$/);
    if (taiwan) return { kind: 'taiwan', symbol: taiwan[1] };
    if (!symbol || symbol.length > 80 || !/^[A-Z0-9.:_-]+$/.test(symbol)) return { kind: 'unsupported', symbol };
    const us = symbol.replace(/^(?:NASDAQ|NYSE|AMEX):/, '');
    if (us.includes(':') || isInternationalSymbol(us)) return { kind: 'international', symbol: us };
    return { kind: /^[A-Z][A-Z0-9.-]*$/.test(us) ? 'us' : 'unsupported', symbol: us };
}
