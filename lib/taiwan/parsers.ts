/**
 * Parses Taiwan ROC and CE date strings into canonical YYYY-MM-DD format.
 * Returns null for invalid, malformed, or impossible dates.
 */
export function parseTaiwanDate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const str = value.trim();
    if (!str) return null;

    let year: number;
    let month: number;
    let day: number;

    // Format 1: Separated dates (e.g. 115/09/01, 115-09-01, 2026/09/01, 2026-09-01)
    const separated = str.match(/^(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (separated) {
        const rawYear = Number(separated[1]);
        month = Number(separated[2]);
        day = Number(separated[3]);
        year = rawYear < 1000 ? rawYear + 1911 : rawYear;
    } else {
        // Format 2: Unseparated 8-digit CE date (e.g. 20260901)
        const ceDigits = str.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (ceDigits) {
            year = Number(ceDigits[1]);
            month = Number(ceDigits[2]);
            day = Number(ceDigits[3]);
        } else {
            // Format 3: Unseparated 6- or 7-digit ROC date (e.g. 1150901 or 991231)
            const rocDigits = str.match(/^(\d{2,3})(\d{2})(\d{2})$/);
            if (rocDigits) {
                year = Number(rocDigits[1]) + 1911;
                month = Number(rocDigits[2]);
                day = Number(rocDigits[3]);
            } else {
                return null;
            }
        }
    }

    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1970 || year > 2100) {
        return null;
    }

    // Verify calendar validity (e.g. Feb 30 does not exist)
    const d = new Date(Date.UTC(year, month - 1, day));
    if (
        d.getUTCFullYear() !== year ||
        d.getUTCMonth() !== month - 1 ||
        d.getUTCDate() !== day
    ) {
        return null;
    }

    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

/**
 * Parses Taiwanese numeric strings, handling commas, signs, HTML wrappers,
 * zero conventions ('0', 0, '-0', 'X0.00'), and null markers ('--', 'N/A').
 */
export function parseTaiwanNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value !== 'string') return null;

    let str = value.trim();
    if (!str || str === '--' || str === 'N/A' || str === 'null') return null;

    // Strip HTML wrappers like <p style="color:red">+1.80</p>
    if (str.includes('<')) {
        str = str.replace(/<[^>]*>/g, '').trim();
        if (!str || str === '--') return null;
    }

    // Strip commas
    str = str.replace(/,/g, '');

    // Handle TWSE 'X' notation (e.g. X0.00 means non-comparable / 0 change)
    if (/^[Xx]/.test(str)) {
        str = str.slice(1).trim();
    }

    if (!str) return null;

    const num = Number(str);
    if (!Number.isFinite(num)) return null;

    return Object.is(num, -0) ? 0 : num;
}

/**
 * Converts YYYY-MM-DD trading date to Unix milliseconds timestamp
 * corresponding to Asia/Taipei midnight (UTC+8).
 */
export function taiwanDateToTimestamp(tradingDate: string): number {
    return Date.parse(`${tradingDate}T00:00:00+08:00`);
}
