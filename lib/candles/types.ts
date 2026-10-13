export type RawCandles = {
    c: number[];
    t: number[];
    o: number[];
    h: number[];
    l: number[];
    v: number[];
    s: 'ok';
    /** False when at least one retained price row had no usable volume. */
    volumeComplete?: boolean;
};

export type CandleFailureReason = 'missing-config' | 'unsupported-symbol' | 'api-error' | 'no-data';
export type CandleSource = {
    provider: 'alpaca' | 'binance' | 'finmind' | 'finnhub' | 'twse' | 'tpex';
    symbol: string;
    timeZone: string;
    priceBasis?: 'unadjusted';
};
export type CandleResult = {
    candles: RawCandles | null;
    reason: CandleFailureReason | null;
    source: CandleSource | null;
};
