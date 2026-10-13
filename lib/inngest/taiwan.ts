import { inngest } from './client';
import { loadTaiwanSyncConfig } from '../taiwan/config';
import { createBudgetedRequest } from '../taiwan/budget';
import { createMongoTaiwanRepository } from '../taiwan/repository';
import { syncTaiwanClose } from '../taiwan/sync';
import { syncTaiwanHistory } from '../taiwan/history';
import type { TaiwanKey } from '../taiwan/types';

export const taiwanAutoSyncEnabled = process.env.TAIWAN_AUTO_SYNC_ENABLED === 'true';

/**
 * Taiwan post-market close sync at 14:30 Taipei time (Mon-Fri).
 * Catches early market close and snapshot quotes.
 */
export const taiwanCloseSync1430 = inngest.createFunction(
    { id: 'taiwan-close-sync-1430', triggers: [{ cron: 'TZ=Asia/Taipei 30 14 * * 1-5' }] },
    async ({ step }) => {
        return await step.run('sync-close-quotes-1430', async () => {
            const config = loadTaiwanSyncConfig(process.env);
            if (!config || !config.autoSyncEnabled) {
                return { success: false, skipped: true, reason: 'auto-sync-disabled' };
            }

            const repo = createMongoTaiwanRepository();
            const request = createBudgetedRequest(repo, config);
            const summary = await syncTaiwanClose({ repo, request, now: new Date() });
            return { success: true, summary };
        });
    }
);

/**
 * Taiwan post-market close sync at 18:00 Taipei time (Mon-Fri).
 * Official post-market confirmation and daily statistics reconciliation.
 */
export const taiwanCloseSync1800 = inngest.createFunction(
    { id: 'taiwan-close-sync-1800', triggers: [{ cron: 'TZ=Asia/Taipei 0 18 * * 1-5' }] },
    async ({ step }) => {
        return await step.run('sync-close-quotes-1800', async () => {
            const config = loadTaiwanSyncConfig(process.env);
            if (!config || !config.autoSyncEnabled) {
                return { success: false, skipped: true, reason: 'auto-sync-disabled' };
            }

            const repo = createMongoTaiwanRepository();
            const request = createBudgetedRequest(repo, config);
            const summary = await syncTaiwanClose({ repo, request, now: new Date() });
            return { success: true, summary };
        });
    }
);

/**
 * Taiwan history synchronization background job triggered by user navigation or backfill requests.
 */
export const taiwanHistorySync = inngest.createFunction(
    { id: 'taiwan-history-sync', triggers: [{ event: 'taiwan/history.sync' }] },
    async ({ event, step }) => {
        return await step.run('sync-history-bars', async () => {
            const config = loadTaiwanSyncConfig(process.env);
            if (!config || !config.historyEnabled) {
                return { success: false, skipped: true, reason: 'history-sync-disabled' };
            }

            const { exchange, code, days } = event.data as {
                exchange: TaiwanKey['exchange'];
                code: string;
                days?: number;
            };

            const repo = createMongoTaiwanRepository();
            const request = createBudgetedRequest(repo, config);
            const summary = await syncTaiwanHistory({
                repo,
                request,
                keys: [{ exchange, code }],
                days: days ?? 800,
                now: new Date(),
            });

            return { success: true, summary };
        });
    }
);

export const taiwanFunctions = [
    taiwanCloseSync1430,
    taiwanCloseSync1800,
    taiwanHistorySync,
];
