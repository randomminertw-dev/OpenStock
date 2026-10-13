import { loadTaiwanSyncConfig } from '../lib/taiwan/config';
import { planTaiwanHistory, syncTaiwanHistory } from '../lib/taiwan/history';
import { syncTaiwanClose } from '../lib/taiwan/sync';
import { parseTaiwanKey } from '../lib/taiwan/symbols';
import { TAIWAN_DATASETS, type TaiwanDatasetId } from '../lib/taiwan/datasets';
import { createMongoTaiwanRepository } from '../lib/taiwan/repository';
import { createBudgetedRequest } from '../lib/taiwan/budget';
import type { TaiwanKey } from '../lib/taiwan/types';

export type CliOptions = {
    dryRun: boolean;
    apply: boolean;
    target: string | null;
    symbols: TaiwanKey[];
    days: number;
    close: boolean;
    catalog: boolean;
    details: boolean;
    history: boolean;
};

export function parseCliArgs(args: string[]): CliOptions {
    let dryRun = false;
    let apply = false;
    let target: string | null = null;
    const symbols: TaiwanKey[] = [];
    let days = 800;
    let close = false;
    let catalog = false;
    let details = false;
    let history = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg === '--apply') {
            apply = true;
        } else if (arg === '--target' && i + 1 < args.length) {
            target = args[++i];
        } else if (arg === '--symbols' && i + 1 < args.length) {
            const rawSymbols = args[++i].split(',');
            for (const s of rawSymbols) {
                const parsed = parseTaiwanKey(s.trim());
                if (parsed) symbols.push(parsed);
            }
        } else if (arg === '--days' && i + 1 < args.length) {
            const parsedDays = Number(args[++i]);
            if (Number.isInteger(parsedDays) && parsedDays > 0) {
                days = Math.min(1000, parsedDays);
            }
        } else if (arg === '--close') {
            close = true;
        } else if (arg === '--catalog') {
            catalog = true;
        } else if (arg === '--details') {
            details = true;
        } else if (arg === '--history') {
            history = true;
        }
    }

    if (!close && !catalog && !details && !history) {
        if (symbols.length > 0) {
            history = true;
        }
    }

    return {
        dryRun,
        apply,
        target,
        symbols,
        days,
        close,
        catalog,
        details,
        history,
    };
}

export async function runCli(
    args: string[],
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
    io: { log: (s: string) => void; error: (s: string) => void } = console
): Promise<number> {
    const opts = parseCliArgs(args);

    if (!opts.dryRun && !opts.apply) {
        io.error('Error: Must specify either --dry-run or --apply');
        return 1;
    }

    if (opts.apply) {
        if (!opts.target) {
            io.error('Error: --apply mode requires an explicit --target <label>');
            return 1;
        }

        const config = loadTaiwanSyncConfig(env);
        if (!config) {
            io.error('Error: --apply mode requires explicit valid Taiwan budget environment variables');
            return 1;
        }
    }

    const targetLabel = opts.target || (opts.dryRun ? 'dry-run' : 'unspecified');

    if (opts.dryRun) {
        io.log(`=== Taiwan Sync CLI [DRY-RUN] ===`);
        io.log(`Target Environment: ${targetLabel}`);

        const plannedUrls: string[] = [];
        let taskCount = 0;

        if (opts.catalog) {
            io.log(`\nMode: Master Catalog Sync`);
            const catalogIds: TaiwanDatasetId[] = ['twse-companies', 'twse-etfs', 'tpex-companies', 'tpex-etfs'];
            for (const id of catalogIds) {
                const entry = TAIWAN_DATASETS[id];
                if (entry) {
                    plannedUrls.push(entry.url);
                    taskCount++;
                }
            }
        }

        if (opts.close) {
            io.log(`\nMode: Post-Market Close Sync`);
            const closeIds: TaiwanDatasetId[] = [
                'twse-holiday',
                'twse-stock-day-all',
                'tpex-mainboard-daily-close-quotes',
            ];
            for (const id of closeIds) {
                const entry = TAIWAN_DATASETS[id];
                if (entry) {
                    plannedUrls.push(entry.url);
                    taskCount++;
                }
            }
        }

        if (opts.details) {
            io.log(`\nMode: Fundamentals & Details Sync`);
            const fundIds: TaiwanDatasetId[] = ['twse-revenue', 'tpex-revenue', 'twse-eps', 'tpex-eps', 'twse-bwibbu-all', 'tpex-peratio-analysis'];
            for (const id of fundIds) {
                const entry = TAIWAN_DATASETS[id];
                if (entry) {
                    plannedUrls.push(entry.url);
                    taskCount++;
                }
            }
        }

        if (opts.history || opts.symbols.length > 0) {
            io.log(`\nMode: History Sync (${opts.days} days)`);
            const now = new Date();
            const twseKeys = opts.symbols.filter(s => s.exchange === 'TWSE');
            const tpexKeys = opts.symbols.filter(s => s.exchange === 'TPEX');

            for (const key of twseKeys) {
                const units = planTaiwanHistory(key, opts.days, now);
                taskCount += units.length;
                for (const u of units) {
                    const ym = u.period.replace('-', '');
                    plannedUrls.push(`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${ym}01&stockNo=${key.code}`);
                }
            }

            if (tpexKeys.length > 0) {
                const units = planTaiwanHistory(tpexKeys[0], opts.days, now);
                taskCount += units.length;
                for (const u of units) {
                    const slashDate = u.period.replace(/-/g, '/');
                    plannedUrls.push(`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${slashDate}&response=json`);
                }
            }
        }

        io.log(`\nPlanned Tasks / Units: ${taskCount}`);
        io.log(`Planned URLs (${plannedUrls.length}):`);
        for (const url of plannedUrls) {
            io.log(`  - ${url}`);
        }

        return 0;
    }

    // Apply Mode (execution)
    io.log(`=== Taiwan Sync CLI [APPLY] ===`);
    io.log(`Target: ${targetLabel}`);

    const config = loadTaiwanSyncConfig(env)!;
    const repo = createMongoTaiwanRepository();
    const request = createBudgetedRequest(repo, config);
    const now = new Date();

    if (opts.close) {
        io.log('Executing close sync...');
        const summary = await syncTaiwanClose({ repo, request, now });
        io.log(`Close sync completed: written=${summary.written}, skipped=${summary.skipped}, failures=${summary.failures.length}`);
    }

    if (opts.history && opts.symbols.length > 0) {
        io.log(`Executing history sync for ${opts.symbols.length} symbols...`);
        const summary = await syncTaiwanHistory({
            repo,
            request,
            keys: opts.symbols,
            days: opts.days,
            now,
        });
        io.log(`History sync completed: written=${summary.written}, failures=${summary.failures.length}`);
    }

    return 0;
}

// Auto-run if executed directly via node
const isMain = typeof require !== 'undefined' && require.main === module;
if (isMain) {
    runCli(process.argv.slice(2)).then(code => {
        if (code !== 0) process.exit(code);
    }).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
