import { describe, expect, it } from 'vitest';
import tpexPeratioFixture from '../../__tests__/fixtures/taiwan/tpex-peratio.json';
import twseAnnouncementsFixture from '../../__tests__/fixtures/taiwan/twse-announcements.json';
import twseBwibbuFixture from '../../__tests__/fixtures/taiwan/twse-bwibbu.json';
import twseEpsFixture from '../../__tests__/fixtures/taiwan/twse-eps.json';
import twseExrightFixture from '../../__tests__/fixtures/taiwan/twse-exright.json';
import twseRevenueFixture from '../../__tests__/fixtures/taiwan/twse-revenue.json';
import { buildTaiwanDetails } from './fundamentals';
import type { TaiwanDatasetBundle, TaiwanSecurity } from './types';

const stock2330: TaiwanSecurity = {
    exchange: 'TWSE',
    code: '2330',
    symbol: 'TWSE:2330',
    name: '台積電',
    kind: 'stock',
    currency: 'TWD',
    listingDate: '1994-09-05',
    status: 'active',
    metadata: {
        industry: '24',
        website: 'https://www.tsmc.com',
    },
    source: 'twse-companies',
    asof: '2026-10-12',
};

const stock1101: TaiwanSecurity = {
    exchange: 'TWSE',
    code: '1101',
    symbol: 'TWSE:1101',
    name: '台泥',
    kind: 'stock',
    currency: 'TWD',
    listingDate: '1962-02-09',
    status: 'active',
    metadata: {},
    source: 'twse-companies',
    asof: '2026-10-12',
};

const etf0050: TaiwanSecurity = {
    exchange: 'TWSE',
    code: '0050',
    symbol: 'TWSE:0050',
    name: '元大台灣50',
    kind: 'etf',
    currency: 'TWD',
    listingDate: '2003-06-30',
    status: 'active',
    metadata: {
        indexName: '臺灣50指數',
        fundType: '國內成分證券指數股票型基金',
        custodian: '臺灣集中保管結算所股份有限公司',
        issuer: '元大證券投資信託股份有限公司',
    },
    source: 'twse-etfs',
    asof: '2026-10-12',
};

describe('buildTaiwanDetails', () => {
    const bundle: TaiwanDatasetBundle = {
        'twse-bwibbu-all': twseBwibbuFixture,
        'tpex-peratio-analysis': tpexPeratioFixture,
        'twse-revenue': twseRevenueFixture,
        'twse-eps': twseEpsFixture,
        'twse-announcements': twseAnnouncementsFixture,
        'twse-exright': twseExrightFixture,
    };

    it('builds fundamental fields for standard stock 2330', () => {
        const details = buildTaiwanDetails(stock2330, bundle);

        expect(details.security).toEqual(stock2330);

        const peField = details.fields.find(f => f.label === '本益比');
        expect(peField).toBeDefined();
        expect(peField?.value).toBe('29.44');
        expect(peField?.unit).toBe('倍');

        const yieldField = details.fields.find(f => f.label === '殖利率');
        expect(yieldField).toBeDefined();
        expect(yieldField?.value).toBe('0.87');
        expect(yieldField?.unit).toBe('%');

        const pbField = details.fields.find(f => f.label === '股價淨值比');
        expect(pbField).toBeDefined();
        expect(pbField?.value).toBe('10.24');
        expect(pbField?.unit).toBe('倍');

        const epsField = details.fields.find(f => f.label === '基本每股盈餘');
        expect(epsField).toBeDefined();
        expect(epsField?.value).toBe('9.56');
        expect(epsField?.period).toBe('2026 Q2');
    });

    it('treats empty PE ratio string as null, not zero', () => {
        const details = buildTaiwanDetails(stock1101, bundle);

        const peField = details.fields.find(f => f.label === '本益比');
        expect(peField).toBeDefined();
        expect(peField?.value).toBeNull();
        expect(peField?.value).not.toBe('0');
        expect(peField?.value).not.toBe(0);
    });

    it('does not display company PE or EPS for ETFs', () => {
        const details = buildTaiwanDetails(etf0050, bundle);

        const peField = details.fields.find(f => f.label === '本益比');
        const epsField = details.fields.find(f => f.label === '基本每股盈餘' || f.label === '每股盈餘');

        expect(peField).toBeUndefined();
        expect(epsField).toBeUndefined();

        // But displays ETF official properties
        const indexField = details.fields.find(f => f.label === '追蹤指數');
        expect(indexField).toBeDefined();
        expect(indexField?.value).toBe('臺灣50指數');

        const fundTypeField = details.fields.find(f => f.label === '基金類型');
        expect(fundTypeField).toBeDefined();
        expect(fundTypeField?.value).toBe('國內成分證券指數股票型基金');
    });

    it('clearly distinguishes cumulative revenue from single-period revenue', () => {
        const details = buildTaiwanDetails(stock2330, bundle);

        const monthlyRevenue = details.fields.find(f => f.label === '當月營業收入');
        expect(monthlyRevenue).toBeDefined();
        expect(monthlyRevenue?.value).toBe('251873000');
        expect(monthlyRevenue?.period).toBe('2026-09');

        const cumulativeRevenue = details.fields.find(f => f.label === '累計營業收入');
        expect(cumulativeRevenue).toBeDefined();
        expect(cumulativeRevenue?.value).toBe('2025847000');
        // Cumulative period must reflect accumulation, not mistaken for a single month
        expect(cumulativeRevenue?.period).toMatch(/(累計|~)/);
        expect(cumulativeRevenue?.period).not.toBe('2026-09');
    });

    it('sanitizes announcement HTML into plain text and enforces HTTPS trusted URLs', () => {
        const details = buildTaiwanDetails(stock2330, bundle);

        expect(details.announcements.length).toBeGreaterThan(0);
        const [first] = details.announcements;

        // No HTML tags allowed in rendered body
        expect(first.body).not.toContain('<script>');
        expect(first.body).not.toContain('</script>');
        expect(first.body).not.toContain('<p>');
        expect(first.body).toContain('普通股每股配發現金股利新台幣4.0元');

        // sourceUrl must be HTTPS
        expect(first.sourceUrl.startsWith('https://')).toBe(true);
    });

    it('records dividend events and issues unadjusted price warning on unverified split', () => {
        const details = buildTaiwanDetails(stock2330, bundle);

        const divEvent = details.events.find(e => e.kind === 'dividend');
        expect(divEvent).toBeDefined();
        expect(divEvent?.date).toBe('2026-09-15');
        expect(divEvent?.title).toContain('4.0');

        const splitEvent = details.events.find(e => e.kind === 'split' || e.kind === 'capital-change');
        expect(splitEvent).toBeDefined();
        // Warns about unadjusted price basis without inventing an unsubstantiated ratio
        expect(splitEvent?.title).toContain('未調整');
    });
});
