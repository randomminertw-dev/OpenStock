import { parseTaiwanDate } from './parsers';
import { parseTaiwanKey, taiwanAliases } from './symbols';
import type { TaiwanCatalogInput, TaiwanExchange, TaiwanSecurity } from './types';

function extractCurrencyFromText(text: string): string | null {
    if (!text) return null;
    if (text.includes('新台幣') || text.includes('NTD') || text.includes('TWD')) {
        return 'TWD';
    }
    if (text.includes('美金') || text.includes('美元') || text.includes('USD')) {
        return 'USD';
    }
    if (text.includes('人民幣') || text.includes('CNY') || text.includes('RMB')) {
        return 'CNY';
    }
    if (text.includes('日圓') || text.includes('日幣') || text.includes('JPY')) {
        return 'JPY';
    }
    return null;
}

function resolveEtfCurrency(name: string, fullName: string, fundType: string): string | null {
    const combined = `${name} ${fullName} ${fundType}`;
    if (
        name.includes('+U') ||
        name.includes('+櫃U') ||
        name.includes('(美元)') ||
        combined.includes('加掛美元') ||
        combined.includes('美元受益憑證')
    ) {
        return 'USD';
    }
    if (
        name.includes('+R') ||
        name.includes('+櫃R') ||
        name.includes('(人民幣)') ||
        combined.includes('加掛人民幣') ||
        combined.includes('人民幣受益憑證')
    ) {
        return 'CNY';
    }
    if (name.includes('+J') || combined.includes('日圓')) {
        return 'JPY';
    }
    // Foreign currency fund without explicit evidenced currency
    if (fundType.includes('外幣') && !combined.includes('新台幣')) {
        return null;
    }
    // Standard domestic Taiwan ETF listing trades in TWD
    return 'TWD';
}

/**
 * Builds the canonical Taiwan security catalog by merging official
 * stock and ETF company masters, preserving known securities even
 * when quote feeds lack entries, and classifying feed-only items as unknown.
 */
export function buildTaiwanCatalog(input: TaiwanCatalogInput): TaiwanSecurity[] {
    const catalogMap = new Map<string, TaiwanSecurity>();

    const makeKey = (exchange: TaiwanExchange, code: string) => `${exchange}:${code}`;

    // 1. TWSE Companies (Stock Master)
    const twseCompanies = input['twse-companies'];
    if (Array.isArray(twseCompanies)) {
        for (const row of twseCompanies as Record<string, unknown>[]) {
            const rawCode = String(row['公司代號'] || '').trim();
            if (!rawCode) continue;

            const name = String(row['公司簡稱'] || row['公司名稱'] || rawCode).trim();
            const fullName = String(row['公司名稱'] || '').trim();
            const parValue = String(row['普通股每股面額'] || '');
            const currency = extractCurrencyFromText(parValue);
            const listingDate = parseTaiwanDate(row['上市日期']);
            const asof = parseTaiwanDate(row['出表日期']) || new Date().toISOString().slice(0, 10);

            const metadata: Record<string, string> = {};
            if (row['產業別']) metadata.industry = String(row['產業別']);
            if (row['網址']) metadata.website = String(row['網址']).trim();
            if (fullName) metadata.fullName = fullName;
            if (row['實收資本額']) metadata.paidInCapital = String(row['實收資本額']);

            const key = makeKey('TWSE', rawCode);
            catalogMap.set(key, {
                exchange: 'TWSE',
                code: rawCode,
                symbol: `TWSE:${rawCode}`,
                name,
                kind: 'stock',
                currency,
                listingDate,
                status: 'active',
                metadata,
                source: 'twse-companies',
                asof,
            });
        }
    }

    // 2. TWSE ETFs (Fund Master)
    const twseEtfs = input['twse-etfs'];
    if (Array.isArray(twseEtfs)) {
        for (const row of twseEtfs as Record<string, unknown>[]) {
            const rawCode = String(row['基金代號'] || '').trim();
            if (!rawCode) continue;

            const name = String(row['基金簡稱'] || row['基金中文名稱'] || rawCode).trim();
            const fullName = String(row['基金中文名稱'] || '').trim();
            const fundType = String(row['基金類型'] || '').trim();
            const currency = resolveEtfCurrency(name, fullName, fundType);
            const listingDate = parseTaiwanDate(row['上市日期']);
            const asof = parseTaiwanDate(row['出表日期']) || new Date().toISOString().slice(0, 10);

            const metadata: Record<string, string> = {};
            if (row['標的指數/追蹤指數名稱']) metadata.indexName = String(row['標的指數/追蹤指數名稱']);
            if (fundType) metadata.fundType = fundType;
            if (fullName) metadata.fullName = fullName;
            if (row['保管機構']) metadata.custodian = String(row['保管機構']);
            if (row['經理公司']) metadata.issuer = String(row['經理公司']);

            const key = makeKey('TWSE', rawCode);
            catalogMap.set(key, {
                exchange: 'TWSE',
                code: rawCode,
                symbol: `TWSE:${rawCode}`,
                name,
                kind: 'etf',
                currency,
                listingDate,
                status: 'active',
                metadata,
                source: 'twse-etfs',
                asof,
            });
        }
    }

    // 3. TPEX Companies (Stock Master)
    const tpexCompanies = input['tpex-companies'];
    if (Array.isArray(tpexCompanies)) {
        for (const row of tpexCompanies as Record<string, unknown>[]) {
            const rawCode = String(row['SecuritiesCompanyCode'] || row['公司代號'] || '').trim();
            if (!rawCode) continue;

            const name = String(row['CompanyAbbreviation'] || row['CompanyName'] || row['公司簡稱'] || rawCode).trim();
            const fullName = String(row['CompanyName'] || '').trim();
            const parValue = String(row['ParValueOfCommonStock'] || row['普通股每股面額'] || '');
            const currency = extractCurrencyFromText(parValue);
            const listingDate = parseTaiwanDate(row['DateOfListing'] || row['上市日期']);
            const asof = parseTaiwanDate(row['Date'] || row['出表日期']) || new Date().toISOString().slice(0, 10);

            const metadata: Record<string, string> = {};
            if (row['SecuritiesIndustryCode']) metadata.industry = String(row['SecuritiesIndustryCode']);
            if (row['WebAddress']) metadata.website = String(row['WebAddress']).trim();
            if (fullName) metadata.fullName = fullName;
            if (row['Paidin.Capital.NTDollars']) metadata.paidInCapital = String(row['Paidin.Capital.NTDollars']);

            const key = makeKey('TPEX', rawCode);
            catalogMap.set(key, {
                exchange: 'TPEX',
                code: rawCode,
                symbol: `TPEX:${rawCode}`,
                name,
                kind: 'stock',
                currency,
                listingDate,
                status: 'active',
                metadata,
                source: 'tpex-companies',
                asof,
            });
        }
    }

    // 4. TPEX ETFs (Fund Master)
    const tpexEtfs = input['tpex-etfs'];
    const tpexEtfRows = Array.isArray(tpexEtfs)
        ? (tpexEtfs as Record<string, unknown>[])
        : tpexEtfs && typeof tpexEtfs === 'object' && Array.isArray((tpexEtfs as { data?: unknown }).data)
          ? ((tpexEtfs as { data: Record<string, unknown>[] }).data)
          : [];

    for (const row of tpexEtfRows) {
        const rawCode = String(row['stockNo'] || row['基金代號'] || '').trim();
        if (!rawCode) continue;

        const name = String(row['stockName'] || row['基金簡稱'] || rawCode).trim();
        const currency = resolveEtfCurrency(name, '', '');
        const listingDate = parseTaiwanDate(row['listingDate'] || row['上市日期']);
        const asof = new Date().toISOString().slice(0, 10);

        const metadata: Record<string, string> = {};
        if (row['indexName']) metadata.indexName = String(row['indexName']);
        if (row['issuer']) metadata.issuer = String(row['issuer']);
        if (row['issuerLink']) metadata.issuerLink = String(row['issuerLink']);

        const key = makeKey('TPEX', rawCode);
        catalogMap.set(key, {
            exchange: 'TPEX',
            code: rawCode,
            symbol: `TPEX:${rawCode}`,
            name,
            kind: 'etf',
            currency,
            listingDate,
            status: 'active',
            metadata,
            source: 'tpex-etfs',
            asof,
        });
    }

    // 5. TWSE Quotes (Supplement / Quotes only)
    const twseQuotes = input['twse-stock-day-all'];
    if (Array.isArray(twseQuotes)) {
        for (const row of twseQuotes as Record<string, unknown>[]) {
            const rawCode = String(row['Code'] || '').trim();
            if (!rawCode) continue;

            const key = makeKey('TWSE', rawCode);
            const existing = catalogMap.get(key);
            if (!existing) {
                const name = String(row['Name'] || rawCode).trim();
                const asof = parseTaiwanDate(row['Date']) || new Date().toISOString().slice(0, 10);
                catalogMap.set(key, {
                    exchange: 'TWSE',
                    code: rawCode,
                    symbol: `TWSE:${rawCode}`,
                    name,
                    kind: 'unknown', // DO NOT guess stock!
                    currency: null,
                    listingDate: null,
                    status: 'active',
                    metadata: {},
                    source: 'twse-stock-day-all',
                    asof,
                });
            }
        }
    }

    // 6. TPEX Quotes (Supplement / Quotes only)
    const tpexQuotes = input['tpex-mainboard-daily-close-quotes'];
    if (Array.isArray(tpexQuotes)) {
        for (const row of tpexQuotes as Record<string, unknown>[]) {
            const rawCode = String(row['SecuritiesCompanyCode'] || '').trim();
            if (!rawCode) continue;

            const key = makeKey('TPEX', rawCode);
            const existing = catalogMap.get(key);
            if (!existing) {
                const name = String(row['CompanyName'] || rawCode).trim();
                const asof = parseTaiwanDate(row['Date']) || new Date().toISOString().slice(0, 10);
                catalogMap.set(key, {
                    exchange: 'TPEX',
                    code: rawCode,
                    symbol: `TPEX:${rawCode}`,
                    name,
                    kind: 'unknown', // DO NOT guess stock!
                    currency: null,
                    listingDate: null,
                    status: 'active',
                    metadata: {},
                    source: 'tpex-mainboard-daily-close-quotes',
                    asof,
                });
            }
        }
    }

    return Array.from(catalogMap.values()).sort((a, b) => {
        if (a.exchange !== b.exchange) {
            return a.exchange === 'TWSE' ? -1 : 1;
        }
        return a.code.localeCompare(b.code);
    });
}

/**
 * Searches Taiwan security catalog by code, Chinese name, or full exchange
 * aliases (e.g. TWSE:2330, 2330.TW, TPEX:6488, 6488.TWO).
 */
export function searchTaiwanCatalog(
    items: TaiwanSecurity[],
    query: string,
    limit = 15
): TaiwanSecurity[] {
    if (!query || typeof query !== 'string') return [];
    const trimmed = query.trim();
    if (!trimmed) return [];

    const upper = trimmed.toUpperCase();
    const explicitKey = parseTaiwanKey(trimmed);

    // Strip exchange prefixes/suffixes to extract pure query code
    const cleanCode = upper
        .replace(/^TWSE:/, '')
        .replace(/^TPEX:/, '')
        .replace(/\.TW$/, '')
        .replace(/\.TWO$/, '')
        .trim();

    const scored: { item: TaiwanSecurity; score: number }[] = [];

    for (const item of items) {
        let score = 0;
        const aliases = taiwanAliases(item).map(a => a.toUpperCase());

        // 1. Explicit Key Match (e.g. TWSE:2330 or 2330.TW)
        if (explicitKey) {
            if (item.exchange === explicitKey.exchange && item.code === explicitKey.code) {
                score = 1000;
            }
        } else if (aliases.includes(upper)) {
            score = 900;
        } else if (item.code === cleanCode) {
            score = 800;
        } else if (item.name === trimmed) {
            score = 700;
        } else if (cleanCode && item.code.startsWith(cleanCode)) {
            score = 600 - (item.code.length - cleanCode.length);
        } else if (item.name.startsWith(trimmed)) {
            score = 500;
        } else if (item.name.toLowerCase().includes(trimmed.toLowerCase())) {
            score = 400;
        } else if (cleanCode && item.code.includes(cleanCode)) {
            score = 300;
        } else if (item.metadata.fullName?.includes(trimmed)) {
            score = 200;
        }

        if (score > 0) {
            scored.push({ item, score });
        }
    }

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.item.code.length !== b.item.code.length) {
            return a.item.code.length - b.item.code.length;
        }
        return a.item.code.localeCompare(b.item.code);
    });

    return scored.slice(0, limit).map(s => s.item);
}
