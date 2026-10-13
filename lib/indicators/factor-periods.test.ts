import { describe, expect, it } from 'vitest';
import { cryptoCoverage, defaultFactorPreference, marketForSymbol, migrateLegacyFactorPreference, parseFactorPreference, presetFactorPreference, withCryptoInterval } from './factor-periods';
import type { FactorMarket } from './factor-periods';

describe('factor preferences', () => {
  it.each([['BINANCE:BTCUSDT', 'crypto'], ['CG:bitcoin', 'crypto'], ['2330.TW', 'taiwan'], ['TWSE:2330', 'taiwan'], ['6488.TWO', 'taiwan'], ['AAPL', 'us'], ['BRK.B', 'us'], ['BRK-B', 'us'], ['0700.HK', null], ['VOD.L', null]])('maps %s to its supported market', (symbol, market) => {
    expect(marketForSymbol(symbol!)).toBe(market);
  });

  it.each(['us', 'taiwan', 'crypto'] as FactorMarket[])('defaults T to ATR21 while preserving M/V/R14 for %s', market => {
    expect(defaultFactorPreference(market)).toEqual({ version: 2, market, preset: 'legacy', periods: { T: 21, M: 14, V: 14, R: 14 }, interval: market === 'crypto' ? '1d' : null });
  });

  it.each(['us', 'taiwan', 'crypto'] as FactorMarket[])('builds presets and enforces all period boundaries for %s', market => {
    const ns = market === 'crypto' ? [10, 30, 180] : [7, 21, 126];
    (['short', 'medium', 'long'] as const).forEach((preset, index) => {
      expect(presetFactorPreference(market, preset).periods).toEqual({ T: [5, 21, 42][index], M: ns[index], V: ns[index], R: ns[index] });
    });
    const valid = defaultFactorPreference(market);
    for (const id of ['T', 'M', 'V', 'R'] as const) {
      const max = id === 'T' ? 50 : ns[2];
      for (const n of [5, max]) expect(parseFactorPreference(market, { ...valid, periods: { ...valid.periods, [id]: n } }).periods[id]).toBe(n);
      for (const n of [4, max + 1, 7.5, NaN, Infinity, '14', null]) {
        expect(() => parseFactorPreference(market, { ...valid, periods: { ...valid.periods, [id]: n } })).toThrow();
      }
    }
  });

  it('normalizes labels from all four periods rather than trusting submitted labels', () => {
    const valid = defaultFactorPreference('us');
    expect(parseFactorPreference('us', { ...valid, preset: 'custom' }).preset).toBe('legacy');
    expect(parseFactorPreference('us', { ...valid, preset: 'long', periods: { T: 5, M: 7, V: 7, R: 7 } }).preset).toBe('short');
    expect(parseFactorPreference('us', { ...valid, preset: 'short', periods: { T: 7, M: 21, V: 10, R: 14 } }).preset).toBe('custom');
  });

  it('migrates old named and custom trend N without losing other factors or crypto interval', () => {
    const oldLong = { market: 'crypto', preset: 'long', periods: { T: 180, M: 180, V: 180, R: 180 }, interval: '8h' };
    expect(migrateLegacyFactorPreference('crypto', oldLong)).toEqual({
      version: 2, market: 'crypto', preset: 'long', periods: { T: 42, M: 180, V: 180, R: 180 }, interval: '8h',
    });
    const oldCustom = { ...oldLong, preset: 'custom', periods: { T: 35, M: 10, V: 30, R: 180 } };
    expect(migrateLegacyFactorPreference('crypto', oldCustom)).toMatchObject({
      preset: 'custom', periods: { T: 21, M: 10, V: 30, R: 180 }, interval: '8h',
    });
  });

  it('rejects old unversioned payloads in the new save parser', () => {
    const valid = defaultFactorPreference('us');
    expect(() => parseFactorPreference('us', { ...valid, version: undefined })).toThrow();
  });

  it('rejects malformed preferences, wrong markets and stock intervals', () => {
    const valid = defaultFactorPreference('us');
    for (const input of [null, [], {}, { ...valid, market: 'crypto' }, { ...valid, periods: { T: 14 } }, { ...valid, interval: '1d' }, { ...valid, preset: 'invalid' }]) {
      expect(() => parseFactorPreference('us', input)).toThrow();
    }
    expect(() => presetFactorPreference('us', 'short', '4h')).toThrow();
  });

  it('accepts only the four crypto intervals', () => {
    for (const interval of ['4h', '8h', '12h', '1d'] as const) {
      expect(presetFactorPreference('crypto', 'short', interval).interval).toBe(interval);
      expect(parseFactorPreference('crypto', { ...defaultFactorPreference('crypto'), interval }).interval).toBe(interval);
    }
    for (const interval of ['1h', '', null, undefined]) expect(() => parseFactorPreference('crypto', { ...defaultFactorPreference('crypto'), interval })).toThrow();
  });

  it('keeps all four candle counts when changing crypto interval', () => {
    const original = parseFactorPreference('crypto', { ...defaultFactorPreference('crypto'), periods: { T: 5, M: 10, V: 30, R: 180 } });
    for (const interval of ['4h', '8h', '12h', '1d'] as const) {
      expect(withCryptoInterval(original, interval)).toEqual({ ...original, interval });
    }
  });

  it.each([
    ['4h', '約20小時', '約30天'],
    ['8h', '約1天16小時', '約60天'],
    ['12h', '約2天12小時', '約90天'],
    ['1d', '約5天', '約180天'],
  ] as const)('shows elapsed time for N=5 and N=180 at %s', (interval, short, long) => {
    expect(cryptoCoverage(5, interval)).toBe(short);
    expect(cryptoCoverage(180, interval)).toBe(long);
  });
});
