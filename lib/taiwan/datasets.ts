import type { TaiwanExchange } from './types';

export type TaiwanDatasetEntry = {
    id: string;
    exchange: TaiwanExchange;
    name: string;
    url: string;
    method: 'GET' | 'POST';
};

export const TAIWAN_DATASETS = {
    'twse-stock-day-all': {
        id: 'twse-stock-day-all',
        exchange: 'TWSE',
        name: '上市每日收盤行情',
        url: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
        method: 'GET',
    },
    'tpex-mainboard-daily-close-quotes': {
        id: 'tpex-mainboard-daily-close-quotes',
        exchange: 'TPEX',
        name: '上櫃每日收盤行情',
        url: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
        method: 'GET',
    },
    'twse-companies': {
        id: 'twse-companies',
        exchange: 'TWSE',
        name: '上市公司基本資料',
        url: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
        method: 'GET',
    },
    'twse-etfs': {
        id: 'twse-etfs',
        exchange: 'TWSE',
        name: '上市基金基本資料',
        url: 'https://openapi.twse.com.tw/v1/opendata/t187ap47_L',
        method: 'GET',
    },
    'tpex-companies': {
        id: 'tpex-companies',
        exchange: 'TPEX',
        name: '上櫃公司基本資料',
        url: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O',
        method: 'GET',
    },
    'tpex-etfs': {
        id: 'tpex-etfs',
        exchange: 'TPEX',
        name: '上櫃 ETF 篩選資料',
        url: 'https://info.tpex.org.tw/api/etfFilter',
        method: 'POST',
    },
    'twse-bwibbu-all': {
        id: 'twse-bwibbu-all',
        exchange: 'TWSE',
        name: '上市個股日本益比、殖利率及股價淨值比',
        url: 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL',
        method: 'GET',
    },
    'tpex-peratio-analysis': {
        id: 'tpex-peratio-analysis',
        exchange: 'TPEX',
        name: '上櫃個股日本益比、殖利率及股價淨值比',
        url: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis',
        method: 'GET',
    },
    'twse-exright': {
        id: 'twse-exright',
        exchange: 'TWSE',
        name: '上市除權息預告表',
        url: 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',
        method: 'GET',
    },
    'tpex-exright': {
        id: 'tpex-exright',
        exchange: 'TPEX',
        name: '上櫃除權息預告表',
        url: 'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost',
        method: 'GET',
    },
    'twse-holiday': {
        id: 'twse-holiday',
        exchange: 'TWSE',
        name: '上市休市日表',
        url: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
        method: 'GET',
    },
} as const;

export type TaiwanDatasetId = keyof typeof TAIWAN_DATASETS;
export type TaiwanDatasetBundle = Partial<Record<TaiwanDatasetId, unknown>>;
