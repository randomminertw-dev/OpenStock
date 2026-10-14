import type { PublishedResearchReport } from './types';

export function mergeReportHistory(previous: PublishedResearchReport[], incoming: PublishedResearchReport): PublishedResearchReport[] {
    return [incoming, ...previous.filter(report => report.id !== incoming.id && report.snapshot.symbol === incoming.snapshot.symbol)].slice(0, 5);
}
