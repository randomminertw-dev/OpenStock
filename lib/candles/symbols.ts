import { isInternationalSymbol } from '@/lib/utils';
import type { TaiwanExchange } from '@/lib/taiwan/types';
import { parseTaiwanKey, TAIWAN_CODE_REGEX } from '@/lib/taiwan/symbols';

export type CandleMarket =
    | { kind: 'taiwan'; symbol: string; exchange?: TaiwanExchange }
    | { kind: 'binance' | 'coingecko' | 'us' | 'international'; symbol: string }
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
    const twKey = parseTaiwanKey(symbol);
    if (twKey) {
        return { kind: 'taiwan', symbol: twKey.code, exchange: twKey.exchange };
    }
    if (TAIWAN_CODE_REGEX.test(symbol)) {
        return { kind: 'taiwan', symbol };
    }
    if (!symbol || symbol.length > 80 || !/^[A-Z0-9.:_-]+$/.test(symbol)) return { kind: 'unsupported', symbol };
    const us = symbol.replace(/^(?:NASDAQ|NYSE|AMEX):/, '');
    if (us.includes(':') || isInternationalSymbol(us)) return { kind: 'international', symbol: us };
    return { kind: /^[A-Z][A-Z0-9.-]*$/.test(us) ? 'us' : 'unsupported', symbol: us };
}
