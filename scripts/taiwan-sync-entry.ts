import { loadTaiwanSyncConfig } from '../lib/taiwan/config';
import { planTaiwanHistory, syncTaiwanHistory } from '../lib/taiwan/history';
import { syncTaiwanClose } from '../lib/taiwan/sync';
import { parseTaiwanKey } from '../lib/taiwan/symbols';
import { TAIWAN_DATASETS, type TaiwanDatasetId } from '../lib/taiwan/datasets';
import { buildTaiwanCatalog } from '../lib/taiwan/catalog';
import { buildTaiwanDetails } from '../lib/taiwan/fundamentals';
import { fetchTaiwanDataset } from '../lib/taiwan/sources';
import { createInMemoryTaiwanRepository, createMongoTaiwanRepository } from '../lib/taiwan/repository';
import { createBudgetedRequest } from '../lib/taiwan/budget';
import type { TaiwanKey, TaiwanRepository, TaiwanRequester, TaiwanSecurity } from '../lib/taiwan/types';

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
    io: { log: (s: string) => void; error: (s: string) => void } = console,
    injectedRepo?: TaiwanRepository,
    injectedRequest?: TaiwanRequester
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
    const repo =
        injectedRepo ??
        (opts.target === 'local'
            ? createInMemoryTaiwanRepository()
            : createMongoTaiwanRepository());
    const request = injectedRequest ?? createBudgetedRequest(repo, config);
    const now = new Date();

    if (opts.catalog) {
        io.log('Executing master catalog sync...');
        const [twseCompanies, twseEtfs, tpexCompanies, tpexEtfs] = await Promise.all([
            fetchTaiwanDataset('twse-companies', request).catch(() => []),
            fetchTaiwanDataset('twse-etfs', request).catch(() => []),
            fetchTaiwanDataset('tpex-companies', request).catch(() => []),
            fetchTaiwanDataset('tpex-etfs', request).catch(() => []),
        ]);
        const catalog = buildTaiwanCatalog({
            'twse-companies': twseCompanies,
            'twse-etfs': twseEtfs,
            'tpex-companies': tpexCompanies,
            'tpex-etfs': tpexEtfs,
        });
        if (catalog.length > 0) {
            await repo.writeCatalog(catalog);
        }
        io.log(`Catalog sync completed: written=${catalog.length}`);
    }

    if (opts.close) {
        io.log('Executing close sync...');
        const summary = await syncTaiwanClose({ repo, request, now });
        io.log(`Close sync completed: written=${summary.written}, skipped=${summary.skipped}, failures=${summary.failures.length}`);
    }

    if (opts.details) {
        io.log('Executing fundamentals and details sync...');
        const [
            twseRev, tpexRev,
            twseEps, tpexEps,
            twseBwibbu, tpexPeratio,
            twseEx, tpexEx,
            twseAnn, tpexAnn,
        ] = await Promise.all([
            fetchTaiwanDataset('twse-revenue', request).catch(() => []),
            fetchTaiwanDataset('tpex-revenue', request).catch(() => []),
            fetchTaiwanDataset('twse-eps', request).catch(() => []),
            fetchTaiwanDataset('tpex-eps', request).catch(() => []),
            fetchTaiwanDataset('twse-bwibbu-all', request).catch(() => []),
            fetchTaiwanDataset('tpex-peratio-analysis', request).catch(() => []),
            fetchTaiwanDataset('twse-exright', request).catch(() => []),
            fetchTaiwanDataset('tpex-exright', request).catch(() => []),
            fetchTaiwanDataset('twse-announcements', request).catch(() => []),
            fetchTaiwanDataset('tpex-announcements', request).catch(() => []),
        ]);

        const bundle = {
            'twse-revenue': twseRev,
            'tpex-revenue': tpexRev,
            'twse-eps': twseEps,
            'tpex-eps': tpexEps,
            'twse-bwibbu-all': twseBwibbu,
            'tpex-peratio-analysis': tpexPeratio,
            'twse-exright': twseEx,
            'tpex-exright': tpexEx,
            'twse-announcements': twseAnn,
            'tpex-announcements': tpexAnn,
        };

        const existingCatalog = await repo.readCatalog();
        const catalogMap = new Map(existingCatalog.map(s => [`${s.exchange}:${s.code}`, s]));
        const targetSecurities: TaiwanSecurity[] = [];

        if (opts.symbols.length > 0) {
            for (const sym of opts.symbols) {
                const found = catalogMap.get(`${sym.exchange}:${sym.code}`);
                if (found) {
                    targetSecurities.push(found);
                } else {
                    targetSecurities.push({
                        exchange: sym.exchange,
                        code: sym.code,
                        symbol: `${sym.exchange}:${sym.code}`,
                        name: sym.code,
                        kind: 'stock',
                        currency: 'TWD',
                        listingDate: null,
                        status: 'active',
                        metadata: {},
                        source: 'cli',
                        asof: now.toISOString().slice(0, 10),
                    });
                }
            }
        } else {
            targetSecurities.push(...existingCatalog);
        }

        let writtenCount = 0;
        for (const sec of targetSecurities) {
            const details = buildTaiwanDetails(sec, bundle);
            await repo.writeDetails(details);
            writtenCount++;
        }
        io.log(`Details sync completed: written=${writtenCount}`);
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
