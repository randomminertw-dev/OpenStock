import { describe, expect, it } from 'vitest';
import {
    parseTaiwanDate,
    parseTaiwanNumber,
    taiwanDateToTimestamp,
} from './parsers';
import {
    parseTaiwanKey,
    taiwanAliases,
} from './symbols';

describe('parseTaiwanDate', () => {
    it('converts ROC slash dates to CE YYYY-MM-DD', () => {
        expect(parseTaiwanDate('115/09/01')).toBe('2026-09-01');
    });

    it('converts ROC contiguous 7-digit strings to CE YYYY-MM-DD', () => {
        expect(parseTaiwanDate('1150901')).toBe('2026-09-01');
    });

    it('converts ROC hyphen dates to CE YYYY-MM-DD', () => {
        expect(parseTaiwanDate('115-09-01')).toBe('2026-09-01');
    });

    it('supports 2-digit ROC years like 99', () => {
        expect(parseTaiwanDate('99/12/31')).toBe('2010-12-31');
    });

    it('supports CE date formats', () => {
        expect(parseTaiwanDate('2026-09-01')).toBe('2026-09-01');
        expect(parseTaiwanDate('2026/09/01')).toBe('2026-09-01');
        expect(parseTaiwanDate('20260901')).toBe('2026-09-01');
    });

    it('returns null for invalid or impossible dates', () => {
        expect(parseTaiwanDate('115/02/30')).toBeNull();
        expect(parseTaiwanDate('115/13/01')).toBeNull();
        expect(parseTaiwanDate('115/09/32')).toBeNull();
        expect(parseTaiwanDate('')).toBeNull();
        expect(parseTaiwanDate('   ')).toBeNull();
        expect(parseTaiwanDate('invalid')).toBeNull();
        expect(parseTaiwanDate(null as unknown as string)).toBeNull();
        expect(parseTaiwanDate(undefined as unknown as string)).toBeNull();
    });
});

describe('parseTaiwanNumber', () => {
    it('removes commas and parses large integers', () => {
        expect(parseTaiwanNumber('20,826,466')).toBe(20826466);
        expect(parseTaiwanNumber('13,645,310')).toBe(13645310);
    });

    it('handles numeric zero and string zero as 0', () => {
        expect(parseTaiwanNumber('0')).toBe(0);
        expect(parseTaiwanNumber(0)).toBe(0);
        expect(parseTaiwanNumber('-0')).toBe(0);
        expect(parseTaiwanNumber('+0')).toBe(0);
    });

    it('parses floats with signs and HTML wrappers', () => {
        expect(parseTaiwanNumber('185.50')).toBe(185.5);
        expect(parseTaiwanNumber('+1.80')).toBe(1.8);
        expect(parseTaiwanNumber('-1.80')).toBe(-1.8);
        expect(parseTaiwanNumber('<p style="color:red">+1.80</p>')).toBe(1.8);
    });

    it('handles TWSE X0.00 notation as 0', () => {
        expect(parseTaiwanNumber('X0.00')).toBe(0);
    });

    it('returns null for empty strings, null, undefined, dashes, and invalid values', () => {
        expect(parseTaiwanNumber('--')).toBeNull();
        expect(parseTaiwanNumber('')).toBeNull();
        expect(parseTaiwanNumber('   ')).toBeNull();
        expect(parseTaiwanNumber(null)).toBeNull();
        expect(parseTaiwanNumber(undefined)).toBeNull();
        expect(parseTaiwanNumber(NaN)).toBeNull();
        expect(parseTaiwanNumber('N/A')).toBeNull();
        expect(parseTaiwanNumber('invalid')).toBeNull();
    });
});

describe('parseTaiwanKey', () => {
    it('parses exchange-prefixed symbols', () => {
        expect(parseTaiwanKey('TWSE:2330')).toEqual({ exchange: 'TWSE', code: '2330' });
        expect(parseTaiwanKey('twse:0050')).toEqual({ exchange: 'TWSE', code: '0050' });
        expect(parseTaiwanKey('TPEX:6488')).toEqual({ exchange: 'TPEX', code: '6488' });
        expect(parseTaiwanKey('tpex:00679B')).toEqual({ exchange: 'TPEX', code: '00679B' });
        expect(parseTaiwanKey('TWSE:00400A')).toEqual({ exchange: 'TWSE', code: '00400A' });
    });

    it('parses suffix-based symbols like .TW and .TWO', () => {
        expect(parseTaiwanKey('2330.TW')).toEqual({ exchange: 'TWSE', code: '2330' });
        expect(parseTaiwanKey('0050.tw')).toEqual({ exchange: 'TWSE', code: '0050' });
        expect(parseTaiwanKey('6488.TWO')).toEqual({ exchange: 'TPEX', code: '6488' });
        expect(parseTaiwanKey('00679B.two')).toEqual({ exchange: 'TPEX', code: '00679B' });
    });

    it('returns null for plain strings without an exchange indication', () => {
        expect(parseTaiwanKey('2330')).toBeNull();
        expect(parseTaiwanKey('0050')).toBeNull();
        expect(parseTaiwanKey('6488')).toBeNull();
        expect(parseTaiwanKey('00400A')).toBeNull();
        expect(parseTaiwanKey('AAPL')).toBeNull();
        expect(parseTaiwanKey('BINANCE:BTCUSDT')).toBeNull();
        expect(parseTaiwanKey('')).toBeNull();
    });
});

describe('taiwanAliases', () => {
    it('returns standard aliases preserving 00400A, leading zeros, and letters', () => {
        expect(taiwanAliases({ exchange: 'TWSE', code: '2330' })).toEqual([
            'TWSE:2330',
            '2330.TW',
            '2330',
        ]);
        expect(taiwanAliases({ exchange: 'TWSE', code: '00400A' })).toEqual([
            'TWSE:00400A',
            '00400A.TW',
            '00400A',
        ]);
        expect(taiwanAliases({ exchange: 'TPEX', code: '6488' })).toEqual([
            'TPEX:6488',
            '6488.TWO',
            '6488',
        ]);
        expect(taiwanAliases({ exchange: 'TPEX', code: '00679B' })).toEqual([
            'TPEX:00679B',
            '00679B.TWO',
            '00679B',
        ]);
    });
});

describe('taiwanDateToTimestamp', () => {
    it('returns milliseconds timestamp for Asia/Taipei midnight', () => {
        const ms = taiwanDateToTimestamp('2026-09-01');
        expect(ms).toBe(Date.parse('2026-09-01T00:00:00+08:00'));
        expect(new Date(ms).toISOString()).toBe('2026-08-31T16:00:00.000Z');
    });
});
