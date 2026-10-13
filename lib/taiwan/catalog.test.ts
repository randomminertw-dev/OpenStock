import { describe, expect, it } from 'vitest';
import tpexCompaniesFixture from '../../__tests__/fixtures/taiwan/tpex-companies.json';
import tpexEtfsFixture from '../../__tests__/fixtures/taiwan/tpex-etfs.json';
import twseCompaniesFixture from '../../__tests__/fixtures/taiwan/twse-companies.json';
import twseEtfsFixture from '../../__tests__/fixtures/taiwan/twse-etfs.json';
import { buildTaiwanCatalog, searchTaiwanCatalog } from './catalog';
import type { TaiwanCatalogInput } from './types';

describe('buildTaiwanCatalog', () => {
    it('classifies 0050 as TWSE ETF even though it is not in the companies list', () => {
        const input: TaiwanCatalogInput = {
            'twse-companies': twseCompaniesFixture,
            'twse-etfs': twseEtfsFixture,
        };

        const catalog = buildTaiwanCatalog(input);
        const item0050 = catalog.find(s => s.code === '0050');

        expect(item0050).toBeDefined();
        expect(item0050).toMatchObject({
            exchange: 'TWSE',
            code: '0050',
            symbol: 'TWSE:0050',
            name: '元大台灣50',
            kind: 'etf',
            currency: 'TWD',
            status: 'active',
            listingDate: '2003-06-30',
        });
    });

    it('classifies 00679B as TPEX ETF and 6488 as TPEX stock', () => {
        const input: TaiwanCatalogInput = {
            'tpex-companies': tpexCompaniesFixture,
            'tpex-etfs': tpexEtfsFixture,
        };

        const catalog = buildTaiwanCatalog(input);

        const item00679B = catalog.find(s => s.code === '00679B');
        expect(item00679B).toBeDefined();
        expect(item00679B).toMatchObject({
            exchange: 'TPEX',
            code: '00679B',
            symbol: 'TPEX:00679B',
            name: '元大美債20年',
            kind: 'etf',
            status: 'active',
            listingDate: '2017-01-17',
        });

        const item6488 = catalog.find(s => s.code === '6488');
        expect(item6488).toBeDefined();
        expect(item6488).toMatchObject({
            exchange: 'TPEX',
            code: '6488',
            symbol: 'TPEX:6488',
            name: '環球晶',
            kind: 'stock',
            currency: 'TWD',
            status: 'active',
            listingDate: '2015-09-25',
        });
    });

    it('preserves known securities even when daily quotes are missing or empty', () => {
        const input: TaiwanCatalogInput = {
            'twse-companies': twseCompaniesFixture,
            'twse-etfs': twseEtfsFixture,
            'twse-stock-day-all': [], // Quotes are empty
        };

        const catalog = buildTaiwanCatalog(input);
        const item2330 = catalog.find(s => s.code === '2330');
        const item0050 = catalog.find(s => s.code === '0050');

        expect(item2330).toBeDefined();
        expect(item2330?.status).toBe('active');
        expect(item0050).toBeDefined();
        expect(item0050?.status).toBe('active');
    });

    it('labels securities appearing only in quote feeds as unknown, not stock and currency as null', () => {
        const input: TaiwanCatalogInput = {
            'twse-companies': [],
            'twse-etfs': [],
            'twse-stock-day-all': [
                {
                    Code: '01001T',
                    Name: '未知商品',
                    Date: '1151012',
                },
            ],
            'tpex-mainboard-daily-close-quotes': [
                {
                    SecuritiesCompanyCode: '7799',
                    CompanyName: '未知上櫃商品',
                    Date: '1151012',
                },
            ],
        };

        const catalog = buildTaiwanCatalog(input);
        const itemUnknown = catalog.find(s => s.code === '01001T');

        expect(itemUnknown).toBeDefined();
        expect(itemUnknown?.kind).toBe('unknown');
        expect(itemUnknown?.kind).not.toBe('stock');
        expect(itemUnknown?.currency).toBeNull();

        const itemTpexUnknown = catalog.find(s => s.code === '7799');
        expect(itemTpexUnknown).toBeDefined();
        expect(itemTpexUnknown?.kind).toBe('unknown');
        expect(itemTpexUnknown?.currency).toBeNull();
    });

    it('sets currency to null for foreign securities without explicit currency evidence', () => {
        const input: TaiwanCatalogInput = {
            'twse-companies': twseCompaniesFixture,
        };

        const catalog = buildTaiwanCatalog(input);
        const foreignItem = catalog.find(s => s.code === '9999F');

        expect(foreignItem).toBeDefined();
        expect(foreignItem?.currency).toBeNull();
    });

    it('does not assume USD for ETFs holding foreign assets unless trading currency is verified', () => {
        const input: TaiwanCatalogInput = {
            'tpex-etfs': tpexEtfsFixture,
            'twse-etfs': twseEtfsFixture,
        };

        const catalog = buildTaiwanCatalog(input);
        const item00679B = catalog.find(s => s.code === '00679B');

        // 00679B tracks US 20+ year treasury bond, but trades in TWD in Taiwan
        expect(item00679B?.currency).toBe('TWD');
        expect(item00679B?.currency).not.toBe('USD');

        // 00636K is explicitly 加掛美元 (+U)
        const item00636K = catalog.find(s => s.code === '00636K');
        expect(item00636K?.currency).toBe('USD');

        // 00625K is explicitly 加掛人民幣 (+R)
        const item00625K = catalog.find(s => s.code === '00625K');
        expect(item00625K?.currency).toBe('CNY');
    });
});

describe('searchTaiwanCatalog', () => {
    const sampleCatalog = buildTaiwanCatalog({
        'twse-companies': twseCompaniesFixture,
        'twse-etfs': twseEtfsFixture,
        'tpex-companies': tpexCompaniesFixture,
        'tpex-etfs': tpexEtfsFixture,
    });

    it('yields consistent results across plain code, Chinese name, prefix, and suffix queries', () => {
        // Query by code
        const byCode = searchTaiwanCatalog(sampleCatalog, '2330');
        expect(byCode[0]?.symbol).toBe('TWSE:2330');

        // Query by Chinese name
        const byName = searchTaiwanCatalog(sampleCatalog, '台積電');
        expect(byName[0]?.symbol).toBe('TWSE:2330');

        // Query by prefix (TWSE:2330)
        const byPrefix = searchTaiwanCatalog(sampleCatalog, 'TWSE:2330');
        expect(byPrefix[0]?.symbol).toBe('TWSE:2330');

        // Query by suffix (2330.TW)
        const bySuffix = searchTaiwanCatalog(sampleCatalog, '2330.TW');
        expect(bySuffix[0]?.symbol).toBe('TWSE:2330');

        // Case-insensitivity and trimming
        const byLower = searchTaiwanCatalog(sampleCatalog, '  twse:2330  ');
        expect(byLower[0]?.symbol).toBe('TWSE:2330');

        const byDotTwLower = searchTaiwanCatalog(sampleCatalog, '2330.tw');
        expect(byDotTwLower[0]?.symbol).toBe('TWSE:2330');
    });

    it('finds TPEX securities by code, name, and exchange prefix/suffix', () => {
        const byCode = searchTaiwanCatalog(sampleCatalog, '00679B');
        expect(byCode[0]?.symbol).toBe('TPEX:00679B');

        const byPrefix = searchTaiwanCatalog(sampleCatalog, 'TPEX:00679B');
        expect(byPrefix[0]?.symbol).toBe('TPEX:00679B');

        const bySuffix = searchTaiwanCatalog(sampleCatalog, '00679B.TWO');
        expect(bySuffix[0]?.symbol).toBe('TPEX:00679B');

        const byName = searchTaiwanCatalog(sampleCatalog, '環球晶');
        expect(byName[0]?.symbol).toBe('TPEX:6488');
    });

    it('handles empty, whitespace, and unmatched queries gracefully', () => {
        expect(searchTaiwanCatalog(sampleCatalog, '')).toEqual([]);
        expect(searchTaiwanCatalog(sampleCatalog, '   ')).toEqual([]);
        expect(searchTaiwanCatalog(sampleCatalog, 'NON_EXISTENT_SYMBOL_XYZ')).toEqual([]);
    });

    it('does not falsely match catalog items when query is a bare market prefix or suffix', () => {
        expect(searchTaiwanCatalog(sampleCatalog, 'TWSE:')).toEqual([]);
        expect(searchTaiwanCatalog(sampleCatalog, 'TPEX:')).toEqual([]);
        expect(searchTaiwanCatalog(sampleCatalog, '.TW')).toEqual([]);
        expect(searchTaiwanCatalog(sampleCatalog, '.TWO')).toEqual([]);
    });

    it('respects the limit argument', () => {
        const results = searchTaiwanCatalog(sampleCatalog, '00', 2);
        expect(results.length).toBeLessThanOrEqual(2);
    });
});
