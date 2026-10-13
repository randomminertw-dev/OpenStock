import { CandleRequestError, createCandleCache, failure } from '../candles/shared';
import type { CandleResult, CandleSource, RawCandles } from '../candles/types';
import { getTaiwanRepository, getTaiwanSecurity, getTaiwanTestRepository } from './reads';
import { parseTaiwanKey, TAIWAN_CODE_REGEX } from './symbols';
import type { TaiwanBar, TaiwanKey, TaiwanRepository } from './types';

const cache = createCandleCache();
const DAY = 86400_000;

export async function __resetTaiwanCandlesCacheForTests(): Promise<void> {
    cache.clear();
}

function isValidBar(b: TaiwanBar): boolean {
    if (!b || typeof b !== 'object') return false;
    if (b.complete !== true) return false;
    const { o, h, l, c, v } = b;
    if (![o, h, l, c].every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) {
        return false;
    }
    if (typeof v === 'number' && Number.isFinite(v) && v < 0) {
        return false;
    }
    const t = typeof b.t === 'number' && Number.isFinite(b.t) && b.t > 0
        ? (b.t > 1e11 ? Math.floor(b.t / 1000) : Math.floor(b.t))
        : (b.tradingDate ? Math.floor(Date.parse(`${b.tradingDate}T00:00:00+08:00`) / 1000) : NaN);
    if (!Number.isFinite(t) || t <= 0) return false;
    return true;
}

export async function officialTaiwanCandles(
    symbol: string,
    days: number,
    injectedRepo?: TaiwanRepository
): Promise<CandleResult> {
    if (!symbol || typeof symbol !== 'string') return failure('unsupported-symbol');
    const trimmed = symbol.trim();
    if (!trimmed) return failure('unsupported-symbol');
    if (!Number.isInteger(days) || days < 1 || days > 1000) return failure('api-error');

    const repo = getTaiwanRepository(injectedRepo);

    let key: TaiwanKey | null = parseTaiwanKey(trimmed);
    if (!key) {
        try {
            const sec = await getTaiwanSecurity(trimmed, repo);
            if (sec) {
                key = { exchange: sec.exchange, code: sec.code };
            }
        } catch {
            // continue resolution
        }
    }

    if (!key && TAIWAN_CODE_REGEX.test(trimmed)) {
        const code = trimmed.toUpperCase();
        try {
            const tpexBars = await repo.readBars({ exchange: 'TPEX', code });
            if (tpexBars.length > 0) {
                key = { exchange: 'TPEX', code };
            } else {
                const twseBars = await repo.readBars({ exchange: 'TWSE', code });
                if (twseBars.length > 0) {
                    key = { exchange: 'TWSE', code };
                } else {
                    const tpexStatus = await repo.readHistoryStatus({ exchange: 'TPEX', code });
                    if (tpexStatus.state !== 'disabled' || tpexStatus.reason) {
                        key = { exchange: 'TPEX', code };
                    } else {
                        key = { exchange: 'TWSE', code };
                    }
                }
            }
        } catch {
            key = { exchange: 'TWSE', code };
        }
    }

    if (!key) {
        return failure('unsupported-symbol');
    }

    const source: CandleSource = {
        provider: key.exchange === 'TWSE' ? 'twse' : 'tpex',
        symbol: key.code,
        timeZone: 'Asia/Taipei',
        priceBasis: 'unadjusted',
    };

    const cacheKey = `official:${key.exchange}:${key.code}:${days}`;

    const loadCandles = async (): Promise<RawCandles> => {
        const taipeiNow = Date.now() + 8 * 3600_000;
        const through = new Date(taipeiNow).toISOString().slice(0, 10);
        const from = new Date(taipeiNow - days * DAY).toISOString().slice(0, 10);

        const bars = await repo.readBars(key!, from, through);
        const validMap = new Map<number, { t: number; o: number; h: number; l: number; c: number; v: number; volumeComplete: boolean }>();

        for (const b of bars) {
            if (!isValidBar(b)) continue;
            const t = b.t > 1e11 ? Math.floor(b.t / 1000) : Math.floor(b.t);
            const hasVol = typeof b.v === 'number' && Number.isFinite(b.v) && b.v >= 0;
            validMap.set(t, { t, o: b.o, h: b.h, l: b.l, c: b.c, v: hasVol ? b.v : 0, volumeComplete: hasVol });
        }

        if (validMap.size === 0) {
            const status = await repo.readHistoryStatus(key!);
            if (status.state === 'disabled' || status.reason === 'missing-config') {
                throw new CandleRequestError('missing-config');
            }
            if (status.reason === 'api-error') {
                throw new CandleRequestError('api-error');
            }
            throw new CandleRequestError('no-data');
        }

        const sorted = Array.from(validMap.values()).sort((a, b) => a.t - b.t);
        const allVolumeComplete = sorted.every((b) => b.volumeComplete);
        return {
            s: 'ok',
            t: sorted.map((b) => b.t),
            o: sorted.map((b) => b.o),
            h: sorted.map((b) => b.h),
            l: sorted.map((b) => b.l),
            c: sorted.map((b) => b.c),
            v: sorted.map((b) => b.v),
            ...(allVolumeComplete ? { volumeComplete: true } : { volumeComplete: false }),
        };
    };

    if (injectedRepo || getTaiwanTestRepository()) {
        try {
            const raw = await loadCandles();
            return { candles: raw, reason: null, source };
        } catch (err: unknown) {
            const reason = err instanceof CandleRequestError ? err.reason : 'api-error';
            return failure(reason, source);
        }
    }

    return cache.get(cacheKey, source, loadCandles);
}
