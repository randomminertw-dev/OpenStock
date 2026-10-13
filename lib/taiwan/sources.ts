import { TAIWAN_DATASETS, type TaiwanDatasetId } from './datasets';
import { parseTaiwanDate, parseTaiwanNumber, taiwanDateToTimestamp } from './parsers';
import { type TaiwanBar, type TaiwanKey, type TaiwanRequester, TaiwanSourceError } from './types';

function unwrapJson(data: unknown): unknown {
    if (data === null || data === undefined) {
        throw new TaiwanSourceError('api-error', 'Empty upstream response');
    }
    if (typeof data === 'string') {
        const trimmed = data.trim();
        if (
            trimmed.startsWith('<') ||
            trimmed.toLowerCase().includes('<!doctype') ||
            trimmed.toLowerCase().includes('<html')
        ) {
            throw new TaiwanSourceError('api-error', 'HTML response received instead of JSON');
        }
        try {
            return JSON.parse(trimmed);
        } catch {
            throw new TaiwanSourceError('api-error', 'Malformed JSON response');
        }
    }
    return data;
}

function normalizeMonth(period: string): string | null {
    const trimmed = period.trim();
    if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;
    if (/^\d{6}$/.test(trimmed)) return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}`;
    const parsed = parseTaiwanDate(
        trimmed.length <= 7 && !trimmed.includes('-') && !trimmed.includes('/')
            ? `${trimmed}01`
            : trimmed.endsWith('/01')
              ? trimmed
              : `${trimmed}/01`
    ) ?? parseTaiwanDate(trimmed);
    return parsed ? parsed.slice(0, 7) : null;
}

function normalizeDay(period: string): string | null {
    const trimmed = period.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return parseTaiwanDate(trimmed);
}

/**
 * Fetches official raw datasets registered in TAIWAN_DATASETS.
 */
export async function fetchTaiwanDataset(
    id: TaiwanDatasetId,
    request: TaiwanRequester
): Promise<unknown> {
    const entry = TAIWAN_DATASETS[id];
    if (!entry) {
        throw new TaiwanSourceError('api-error', `Unknown dataset ID: ${id}`);
    }
    let raw: unknown;
    try {
        raw = await request(
            entry.url,
            entry.method === 'POST' ? { method: 'POST' } : undefined
        );
    } catch (err) {
        if (err instanceof TaiwanSourceError) throw err;
        throw new TaiwanSourceError('api-error', err instanceof Error ? err.message : String(err));
    }
    return unwrapJson(raw);
}

/**
 * Fetches official daily bars.
 * - For TWSE: fetches monthly daily bars for the requested security (period: YYYY-MM).
 * - For TPEX: fetches all market rows for the requested trading date (period: YYYY-MM-DD),
 *   allowing Task 4 to filter tracked securities from a single daily batch.
 */
export async function fetchTaiwanHistory(
    key: TaiwanKey,
    period: string,
    request: TaiwanRequester
): Promise<TaiwanBar[]> {
    if (key.exchange === 'TWSE') {
        return fetchTwseHistory(key, period, request);
    }
    if (key.exchange === 'TPEX') {
        return fetchTpexDaily(key, period, request);
    }
    throw new TaiwanSourceError('api-error', `Unsupported exchange: ${key.exchange}`);
}

async function fetchTwseHistory(
    key: TaiwanKey,
    period: string,
    request: TaiwanRequester
): Promise<TaiwanBar[]> {
    const targetMonth = normalizeMonth(period);
    if (!targetMonth) {
        throw new TaiwanSourceError('api-error', `Invalid TWSE period: ${period}`);
    }

    const yyyymm01 = `${targetMonth.replace('-', '')}01`;
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${yyyymm01}&stockNo=${key.code}`;

    let response: unknown;
    try {
        response = await request(url);
    } catch (err) {
        if (err instanceof TaiwanSourceError) throw err;
        throw new TaiwanSourceError('api-error', err instanceof Error ? err.message : String(err));
    }

    const raw = unwrapJson(response) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') {
        throw new TaiwanSourceError('api-error', 'TWSE response is not an object');
    }

    const stat = String(raw.stat ?? '');
    if (stat !== 'OK') {
        if (
            stat.includes('沒有符合條件') ||
            stat.includes('查無資料') ||
            stat.includes('非營業日')
        ) {
            return [];
        }
        throw new TaiwanSourceError('api-error', stat || 'TWSE upstream returned non-OK status');
    }

    if (!raw.data || !Array.isArray(raw.data) || raw.data.length === 0) {
        return [];
    }

    // Verify response stock code matches request
    if (raw.title && typeof raw.title === 'string' && !raw.title.includes(key.code)) {
        throw new TaiwanSourceError(
            'api-error',
            `TWSE response stock code mismatch: expected ${key.code} in title "${raw.title}"`
        );
    }

    // Verify response date matches request
    if (raw.date && typeof raw.date === 'string') {
        const respMonth = parseTaiwanDate(raw.date)?.slice(0, 7);
        if (respMonth && respMonth !== targetMonth) {
            throw new TaiwanSourceError(
                'api-error',
                `TWSE response date mismatch: expected month ${targetMonth}, got ${respMonth}`
            );
        }
    }

    if (!Array.isArray(raw.fields)) {
        throw new TaiwanSourceError('api-error', 'TWSE response missing fields array');
    }

    const fields: string[] = raw.fields;
    const dateCol = fields.findIndex(f => f.includes('日期'));
    const volCol = fields.findIndex(f => f.includes('成交股數'));
    const openCol = fields.findIndex(f => f.includes('開盤價') || f.includes('開盤'));
    const highCol = fields.findIndex(f => f.includes('最高價') || f.includes('最高'));
    const lowCol = fields.findIndex(f => f.includes('最低價') || f.includes('最低'));
    const closeCol = fields.findIndex(f => f.includes('收盤價') || f.includes('收盤'));
    const changeCol = fields.findIndex(f => f.includes('漲跌價差') || f.includes('漲跌'));

    if (dateCol === -1 || volCol === -1 || openCol === -1 || highCol === -1 || lowCol === -1 || closeCol === -1) {
        throw new TaiwanSourceError('api-error', 'TWSE response missing required columns in fields');
    }

    const bars: TaiwanBar[] = [];
    const fetchedAt = new Date().toISOString();

    for (const row of raw.data) {
        if (!Array.isArray(row)) continue;

        const tradingDate = parseTaiwanDate(row[dateCol]);
        if (!tradingDate) continue;

        // Filter out cross-month rows
        if (!tradingDate.startsWith(targetMonth)) continue;

        const v = parseTaiwanNumber(row[volCol]);
        const o = parseTaiwanNumber(row[openCol]);
        const h = parseTaiwanNumber(row[highCol]);
        const l = parseTaiwanNumber(row[lowCol]);
        const c = parseTaiwanNumber(row[closeCol]);
        const change = changeCol !== -1 ? parseTaiwanNumber(row[changeCol]) : null;

        if (o === null || h === null || l === null || c === null || v === null) continue;
        if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || v < 0) continue;
        if (h < o || h < c || h < l || l > o || l > c || l > h) continue;

        bars.push({
            exchange: 'TWSE',
            code: key.code,
            tradingDate,
            t: taiwanDateToTimestamp(tradingDate),
            o,
            h,
            l,
            c,
            v,
            change,
            complete: true,
            source: 'twse',
            priceBasis: 'unadjusted',
            fetchedAt,
        });
    }

    if (raw.data.length > 0 && bars.length === 0) {
        throw new TaiwanSourceError('api-error', 'All TWSE data rows were malformed or invalid');
    }

    bars.sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
    return bars;
}

async function fetchTpexDaily(
    _key: TaiwanKey,
    period: string,
    request: TaiwanRequester
): Promise<TaiwanBar[]> {
    const targetDate = normalizeDay(period);
    if (!targetDate) {
        throw new TaiwanSourceError('api-error', `Invalid TPEX period date: ${period}`);
    }

    const slashDate = targetDate.replace(/-/g, '/');
    const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${slashDate}&response=json`;

    let response: unknown;
    try {
        response = await request(url);
    } catch (err) {
        if (err instanceof TaiwanSourceError) throw err;
        throw new TaiwanSourceError('api-error', err instanceof Error ? err.message : String(err));
    }

    const raw = unwrapJson(response) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') {
        throw new TaiwanSourceError('api-error', 'TPEX response is not an object');
    }

    const stat = String(raw.stat ?? '').toLowerCase();
    if (stat !== 'ok') {
        if (
            stat.includes('沒有符合條件') ||
            stat.includes('查無資料') ||
            stat.includes('非營業日')
        ) {
            return [];
        }
        throw new TaiwanSourceError('api-error', String(raw.stat ?? '') || 'TPEX upstream returned non-ok status');
    }

    if (!raw.tables || !Array.isArray(raw.tables) || raw.tables.length === 0) {
        return [];
    }

    // Verify response date matches request
    if (raw.date && typeof raw.date === 'string') {
        const respDate = parseTaiwanDate(raw.date);
        if (respDate && respDate !== targetDate) {
            throw new TaiwanSourceError(
                'api-error',
                `TPEX response date mismatch: expected ${targetDate}, got ${respDate}`
            );
        }
    }

    type TpexTable = { fields?: string[]; data?: unknown[][] };
    const tables = raw.tables as TpexTable[];
    const table = tables.find(
        t =>
            Array.isArray(t?.fields) &&
            t.fields.some(f => typeof f === 'string' && f.includes('代號')) &&
            t.fields.some(f => typeof f === 'string' && f.includes('收盤'))
    ) ?? tables[0];

    if (!table || !Array.isArray(table.fields) || !Array.isArray(table.data)) {
        throw new TaiwanSourceError('api-error', 'TPEX response missing table fields or data');
    }

    if (table.data.length === 0) {
        return [];
    }

    const fields: string[] = table.fields;
    const codeCol = fields.findIndex(f => f.includes('代號'));
    const volCol = fields.findIndex(f => f.includes('成交股數'));
    const openCol = fields.findIndex(f => f.includes('開盤'));
    const highCol = fields.findIndex(f => f.includes('最高'));
    const lowCol = fields.findIndex(f => f.includes('最低'));
    const closeCol = fields.findIndex(f => f.includes('收盤'));
    const changeCol = fields.findIndex(f => f.includes('漲跌'));
    const dateCol = fields.findIndex(f => f.includes('日期'));

    if (codeCol === -1 || volCol === -1 || openCol === -1 || highCol === -1 || lowCol === -1 || closeCol === -1) {
        throw new TaiwanSourceError('api-error', 'TPEX table missing required columns in fields');
    }

    const bars: TaiwanBar[] = [];
    const fetchedAt = new Date().toISOString();

    for (const row of table.data) {
        if (!Array.isArray(row)) continue;

        const rowCode = String(row[codeCol] ?? '').trim().toUpperCase();
        // Ignore non-security summary/header rows (e.g. 合計, 大盤)
        if (!/^[0-9][A-Z0-9]{3,7}$/.test(rowCode)) continue;

        const tradingDate = (dateCol !== -1 ? parseTaiwanDate(row[dateCol]) : null) ?? targetDate;

        const v = parseTaiwanNumber(row[volCol]);
        const o = parseTaiwanNumber(row[openCol]);
        const h = parseTaiwanNumber(row[highCol]);
        const l = parseTaiwanNumber(row[lowCol]);
        const c = parseTaiwanNumber(row[closeCol]);
        const change = changeCol !== -1 ? parseTaiwanNumber(row[changeCol]) : null;

        if (o === null || h === null || l === null || c === null || v === null) continue;
        if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || v < 0) continue;
        if (h < o || h < c || h < l || l > o || l > c || l > h) continue;

        bars.push({
            exchange: 'TPEX',
            code: rowCode,
            tradingDate,
            t: taiwanDateToTimestamp(tradingDate),
            o,
            h,
            l,
            c,
            v,
            change,
            complete: true,
            source: 'tpex',
            priceBasis: 'unadjusted',
            fetchedAt,
        });
    }

    if (table.data.length > 0 && bars.length === 0) {
        throw new TaiwanSourceError('api-error', 'All TPEX data rows were malformed or invalid');
    }

    bars.sort((a, b) => a.code.localeCompare(b.code));
    return bars;
}
