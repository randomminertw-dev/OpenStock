import type { Category } from './types';

/** Shared by server-rendered summaries and client-rendered indicator rows. */
export const CATEGORY_LABEL: Record<Category, string> = {
    trend: '趨勢',
    momentum: '動能',
    volatility: '波動',
    volume: '成交量',
    support: '支撐壓力',
    breadth: '市場廣度',
};
