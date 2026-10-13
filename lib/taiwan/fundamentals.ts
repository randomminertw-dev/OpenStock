import { parseTaiwanDate, parseTaiwanNumber } from './parsers';
import type {
    TaiwanDatasetBundle,
    TaiwanDetails,
    TaiwanEvent,
    TaiwanSecurity,
} from './types';

const TRUSTED_DOMAINS = [
    'twse.com.tw',
    'openapi.twse.com.tw',
    'tpex.org.tw',
    'info.tpex.org.tw',
    'mops.twse.com.tw',
];

function sanitizeUrl(rawUrl: string | undefined, issuerWebsite?: string): string {
    const fallback = 'https://mops.twse.com.tw/mops/web/t05st02';
    if (!rawUrl || typeof rawUrl !== 'string') {
        return fallback;
    }
    const trimmed = rawUrl.trim();
    if (!trimmed.startsWith('https://')) {
        // Upgrade HTTP to HTTPS if domain is trusted or issuer website
        if (trimmed.startsWith('http://')) {
            const upgraded = trimmed.replace(/^http:\/\//, 'https://');
            return sanitizeUrl(upgraded, issuerWebsite);
        }
        return fallback;
    }

    try {
        const parsed = new URL(trimmed);
        const hostname = parsed.hostname.toLowerCase();

        const isTrustedOfficial = TRUSTED_DOMAINS.some(
            d => hostname === d || hostname.endsWith(`.${d}`)
        );
        if (isTrustedOfficial) return trimmed;

        if (issuerWebsite) {
            try {
                const issuerUrl = new URL(
                    issuerWebsite.startsWith('http') ? issuerWebsite : `https://${issuerWebsite}`
                );
                const issuerHost = issuerUrl.hostname.toLowerCase();
                if (issuerHost && (hostname === issuerHost || hostname.endsWith(`.${issuerHost}`))) {
                    return trimmed;
                }
            } catch {
                // Ignore parse errors
            }
        }

        return fallback;
    } catch {
        return fallback;
    }
}

function stripHtml(input: string): string {
    if (!input) return '';
    return input.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/**
 * Builds comprehensive Taiwan fundamental details, combining valuation ratios,
 * revenues, earnings, sanitized material announcements, and corporate action events.
 *
 * Rules:
 * 1. ETFs must NOT display company PE/EPS.
 * 2. Empty/missing PE ratios must be null, not 0.
 * 3. Cumulative periods must be explicitly distinguished from single periods.
 * 4. Announcement bodies must be rendered as plain text, URLs must be HTTPS.
 * 5. Splits without definitive ratio must warn about unadjusted price without guessing.
 */
export function buildTaiwanDetails(
    security: TaiwanSecurity,
    datasets: TaiwanDatasetBundle
): TaiwanDetails {
    const fields: { label: string; value: string | null; period: string | null; unit: string | null }[] = [];
    const announcements: { date: string; title: string; body: string; sourceUrl: string }[] = [];
    const events: TaiwanEvent[] = [];

    // --- 1. Fields for Stocks ---
    if (security.kind === 'stock') {
        // A. Valuation (PE / Yield / PB)
        if (security.exchange === 'TWSE') {
            const bwibbu = datasets['twse-bwibbu-all'];
            if (Array.isArray(bwibbu)) {
                const row = (bwibbu as Record<string, unknown>[]).find(
                    r => String(r.Code || '').trim() === security.code
                );
                if (row) {
                    const rawPe = String(row.PEratio ?? '').trim();
                    const peNum = rawPe && rawPe !== '--' ? parseTaiwanNumber(rawPe) : null;
                    fields.push({
                        label: '本益比',
                        value: peNum !== null ? String(peNum) : null,
                        period: null,
                        unit: '倍',
                    });

                    const rawYield = String(row.DividendYield ?? '').trim();
                    const yieldNum = rawYield && rawYield !== '--' ? parseTaiwanNumber(rawYield) : null;
                    fields.push({
                        label: '殖利率',
                        value: yieldNum !== null ? String(yieldNum) : null,
                        period: null,
                        unit: '%',
                    });

                    const rawPb = String(row.PBratio ?? '').trim();
                    const pbNum = rawPb && rawPb !== '--' ? parseTaiwanNumber(rawPb) : null;
                    fields.push({
                        label: '股價淨值比',
                        value: pbNum !== null ? String(pbNum) : null,
                        period: null,
                        unit: '倍',
                    });
                }
            }
        } else if (security.exchange === 'TPEX') {
            const peratio = datasets['tpex-peratio-analysis'];
            if (Array.isArray(peratio)) {
                const row = (peratio as Record<string, unknown>[]).find(
                    r => String(r.SecuritiesCompanyCode || '').trim() === security.code
                );
                if (row) {
                    const rawPe = String(row.PriceEarningRatio ?? '').trim();
                    const peNum = rawPe && rawPe !== '--' ? parseTaiwanNumber(rawPe) : null;
                    fields.push({
                        label: '本益比',
                        value: peNum !== null ? String(peNum) : null,
                        period: null,
                        unit: '倍',
                    });

                    const rawYield = String(row.YieldRatio ?? '').trim();
                    const yieldNum = rawYield && rawYield !== '--' ? parseTaiwanNumber(rawYield) : null;
                    fields.push({
                        label: '殖利率',
                        value: yieldNum !== null ? String(yieldNum) : null,
                        period: null,
                        unit: '%',
                    });

                    const rawPb = String(row.PriceBookRatio ?? '').trim();
                    const pbNum = rawPb && rawPb !== '--' ? parseTaiwanNumber(rawPb) : null;
                    fields.push({
                        label: '股價淨值比',
                        value: pbNum !== null ? String(pbNum) : null,
                        period: null,
                        unit: '倍',
                    });
                }
            }
        }

        // B. Revenue (營業收入)
        const revenueData =
            datasets[security.exchange === 'TWSE' ? 'twse-revenue' : 'tpex-revenue'];
        if (Array.isArray(revenueData)) {
            const row = (revenueData as Record<string, unknown>[]).find(
                r =>
                    String(r['公司代號'] || r['SecuritiesCompanyCode'] || '').trim() ===
                    security.code
            );
            if (row) {
                const rawPeriod = String(row['資料年月'] || '').trim();
                const parsedDate = parseTaiwanDate(`${rawPeriod}01`);
                const monthPeriod = parsedDate ? parsedDate.slice(0, 7) : rawPeriod;

                const monthly = parseTaiwanNumber(row['營業收入-當月營收']);
                fields.push({
                    label: '當月營業收入',
                    value: monthly !== null ? String(monthly) : null,
                    period: monthPeriod,
                    unit: '千元',
                });

                const yoy = parseTaiwanNumber(row['營業收入-去年同月增減(%)']);
                fields.push({
                    label: '營業收入去年同月增減',
                    value: yoy !== null ? String(yoy) : null,
                    period: monthPeriod,
                    unit: '%',
                });

                const cumulative = parseTaiwanNumber(row['累計營業收入-當月累計營收']);
                const monthNum = monthPeriod.includes('-')
                    ? parseInt(monthPeriod.slice(5, 7), 10)
                    : null;
                const cumPeriod = monthNum
                    ? `${monthPeriod.slice(0, 4)}年1-${monthNum}月累計`
                    : `${monthPeriod} 累計`;

                fields.push({
                    label: '累計營業收入',
                    value: cumulative !== null ? String(cumulative) : null,
                    period: cumPeriod,
                    unit: '千元',
                });
            }
        }

        // C. EPS (每股盈餘)
        const epsData =
            datasets[security.exchange === 'TWSE' ? 'twse-eps' : 'tpex-eps'];
        if (Array.isArray(epsData)) {
            const row = (epsData as Record<string, unknown>[]).find(
                r =>
                    String(r['公司代號'] || r['SecuritiesCompanyCode'] || '').trim() ===
                    security.code
            );
            if (row) {
                const yearRaw = Number(row['年度'] || row['Year'] || 0);
                const yearCe = yearRaw < 1000 ? yearRaw + 1911 : yearRaw;
                const quarter = String(row['季別'] || '').trim();
                const epsPeriod = quarter ? `${yearCe} Q${quarter}` : `${yearCe}`;

                const eps = parseTaiwanNumber(row['基本每股盈餘(元)'] || row['基本每股盈餘']);
                fields.push({
                    label: '基本每股盈餘',
                    value: eps !== null ? String(eps) : null,
                    period: epsPeriod,
                    unit: '元',
                });
            }
        }
    }

    // --- 2. Fields for ETFs ---
    if (security.kind === 'etf') {
        if (security.metadata.indexName) {
            fields.push({
                label: '追蹤指數',
                value: security.metadata.indexName,
                period: null,
                unit: null,
            });
        }
        if (security.metadata.fundType) {
            fields.push({
                label: '基金類型',
                value: security.metadata.fundType,
                period: null,
                unit: null,
            });
        }
        if (security.metadata.issuer) {
            fields.push({
                label: '發行人',
                value: security.metadata.issuer,
                period: null,
                unit: null,
            });
        }
        if (security.listingDate) {
            fields.push({
                label: '上市日期',
                value: security.listingDate,
                period: null,
                unit: null,
            });
        }
        if (security.metadata.custodian) {
            fields.push({
                label: '保管機構',
                value: security.metadata.custodian,
                period: null,
                unit: null,
            });
        }
    }

    // --- 3. Announcements ---
    const annData =
        datasets[security.exchange === 'TWSE' ? 'twse-announcements' : 'tpex-announcements'];
    if (Array.isArray(annData)) {
        for (const row of annData as Record<string, unknown>[]) {
            const rowCode = String(row['公司代號'] || row['SecuritiesCompanyCode'] || '').trim();
            if (rowCode !== security.code) continue;

            const date = parseTaiwanDate(row['發言日期'] || row['Date']) || '';
            const title = stripHtml(String(row['主旨 '] || row['主旨'] || ''));
            const body = stripHtml(String(row['說明'] || ''));
            const sourceUrl = sanitizeUrl(
                String(row['網址'] || row['WebAddress'] || ''),
                security.metadata.website || security.metadata.issuerLink
            );

            announcements.push({
                date,
                title,
                body,
                sourceUrl,
            });
        }
    }

    // --- 4. Events (Dividends, Splits, Capital Changes) ---
    const exrightData =
        datasets[security.exchange === 'TWSE' ? 'twse-exright' : 'tpex-exright'];
    if (Array.isArray(exrightData)) {
        for (const row of exrightData as Record<string, unknown>[]) {
            const rowCode = String(row['Code'] || row['SecuritiesCompanyCode'] || '').trim();
            if (rowCode !== security.code) continue;

            const date = parseTaiwanDate(row['Date'] || row['ExRrightsExDividendDate']) || '';
            const exType = String(row['Exdividend'] || row['ExRrightsExDividend'] || '').trim();

            const cash = parseTaiwanNumber(row['CashDividend']);
            const stockDiv = parseTaiwanNumber(row['StockDividendRatio']);

            if (exType.includes('分割') || exType.includes('減資')) {
                events.push({
                    date,
                    kind: 'split',
                    title: `股票分割/減資（官方未提供確認比例，價格維持未調整口徑）`,
                    source: security.exchange.toLowerCase(),
                });
            } else if (cash !== null && cash > 0) {
                const cashDisplay = Number.isInteger(cash) ? `${cash}.0` : String(cash);
                events.push({
                    date,
                    kind: 'dividend',
                    title: `除息：現金股利 ${cashDisplay} 元`,
                    source: security.exchange.toLowerCase(),
                });
            } else if (stockDiv !== null && stockDiv > 0) {
                events.push({
                    date,
                    kind: 'dividend',
                    title: `除權：股票股利比率 ${stockDiv}`,
                    source: security.exchange.toLowerCase(),
                });
            } else {
                events.push({
                    date,
                    kind: 'dividend',
                    title: `除權息公告`,
                    source: security.exchange.toLowerCase(),
                });
            }
        }
    }

    return {
        security,
        fields,
        announcements,
        events,
        asof: security.asof || null,
    };
}
