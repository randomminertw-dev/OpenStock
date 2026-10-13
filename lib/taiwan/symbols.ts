import type { TaiwanExchange, TaiwanKey } from './types';

const TAIWAN_CODE_REGEX = /^[0-9][A-Z0-9]{3,7}$/;

/**
 * Parses strings that explicitly indicate a Taiwan market (TWSE:code, TPEX:code,
 * code.TW, code.TWO). Plain strings without a market indicator return null.
 */
export function parseTaiwanKey(value: string): TaiwanKey | null {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const upper = trimmed.toUpperCase();

    let exchange: TaiwanExchange | null = null;
    let rawCode = '';

    if (upper.startsWith('TWSE:')) {
        exchange = 'TWSE';
        rawCode = upper.slice(5).trim();
    } else if (upper.startsWith('TPEX:')) {
        exchange = 'TPEX';
        rawCode = upper.slice(5).trim();
    } else if (upper.endsWith('.TW')) {
        exchange = 'TWSE';
        rawCode = upper.slice(0, -3).trim();
    } else if (upper.endsWith('.TWO')) {
        exchange = 'TPEX';
        rawCode = upper.slice(0, -4).trim();
    }

    if (!exchange || !rawCode || !TAIWAN_CODE_REGEX.test(rawCode)) {
        return null;
    }

    return { exchange, code: rawCode };
}

/**
 * Returns standard aliases for a Taiwan security key.
 * Preserves leading zeroes and letter suffixes (e.g. 00400A, 00679B).
 */
export function taiwanAliases(key: TaiwanKey): string[] {
    const { exchange, code } = key;
    if (exchange === 'TWSE') {
        return [`TWSE:${code}`, `${code}.TW`, code];
    }
    return [`TPEX:${code}`, `${code}.TWO`, code];
}
