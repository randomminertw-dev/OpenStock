'use server';
import { requireUserId } from '@/lib/better-auth/auth';
import { canonicalResearchSymbol, loadResearchSnapshot } from '@/lib/analysis/load';
import { createResearchReportRepository } from '@/lib/analysis/repository';
import { createResearchReportService } from '@/lib/analysis/service';
import type { PublishedResearchReport, ResearchGenerationResult } from '@/lib/analysis/types';

export async function generateResearchReport(symbol: string): Promise<ResearchGenerationResult> {
    let owner: string;
    try { owner = await requireUserId(); }
    catch { return { ok: false, code: 'unauthorized', message: '請先登入後產生研究報告。' }; }
    const canonical = canonicalResearchSymbol(symbol);
    if (!canonical) return { ok: false, code: 'unsupported-symbol', message: '此標的尚未支援研究報告；台股請使用含交易所的代碼。' };
    return createResearchReportService({ repo: createResearchReportRepository(), load: loadResearchSnapshot }).generate(owner, canonical);
}
export async function getResearchReports(symbol: string): Promise<{ ok: true; reports: PublishedResearchReport[] } | { ok: false; message: string }> {
    let owner: string;
    try { owner = await requireUserId(); }
    catch { return { ok: false, message: '請先登入後檢視研究報告。' }; }
    const canonical = canonicalResearchSymbol(symbol);
    if (!canonical) return { ok: false, message: '此標的尚未支援研究報告。' };
    try { return { ok: true, reports: await createResearchReportRepository().list(owner, canonical) }; }
    catch { return { ok: false, message: '研究報告暫時無法讀取，請稍後重試。' }; }
}
