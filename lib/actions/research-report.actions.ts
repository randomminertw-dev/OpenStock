'use server';
import { requireUserId } from '@/lib/better-auth/auth';
import { canonicalResearchSymbol, loadResearchSnapshot } from '@/lib/analysis/load';
import { createResearchReportRepository } from '@/lib/analysis/repository';
import { createResearchReportService } from '@/lib/analysis/service';
import { vmEnabled } from '@/lib/analysis/vm-contract';
import { enqueueVmResearch, readVmResearch, readVmResearchForReport } from '@/lib/analysis/vm-jobs';
import type { PublishedResearchReport, ResearchGenerationResult } from '@/lib/analysis/types';

export async function generateResearchReport(symbol: string): Promise<ResearchGenerationResult> {
    let owner: string;
    try { owner = await requireUserId(); }
    catch { return { ok: false, code: 'unauthorized', message: '請先登入後產生研究報告。' }; }
    const canonical = canonicalResearchSymbol(symbol);
    if (!canonical) return { ok: false, code: 'unsupported-symbol', message: '此標的尚未支援研究報告；台股請使用含交易所的代碼。' };
    const result = await createResearchReportService({ repo: createResearchReportRepository(), load: loadResearchSnapshot }).generate(owner, canonical);
    if (!result.ok || !vmEnabled()) return result;
    try { return { ...result, vmJobId: await enqueueVmResearch(owner, result.report) }; }
    catch { return { ...result, vmMessage: 'VM 工作暫時無法建立，已提供基本規則報告。' }; }
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

export async function getVmResearchStatus(jobId: string) {
    let owner: string;
    try { owner = await requireUserId(); } catch { return { ok: false as const, message: '請先登入後檢視研究工作。' }; }
    if (!vmEnabled()) return { ok: false as const, message: 'VM 未啟用，使用基本規則報告。' };
    try { return await readVmResearch(owner, jobId); } catch { return { ok: false as const, message: 'VM 狀態暫時無法讀取，基本報告仍可閱讀。' }; }
}

export async function getVmResearchForReport(reportId: string) {
    let owner:string;
    try {owner=await requireUserId();} catch {return {ok:false as const,message:'請先登入後檢視研究工作。'};}
    if(!vmEnabled())return null;
    try{return await readVmResearchForReport(owner,reportId);}catch{return {ok:false as const,message:'VM 狀態暫時無法讀取，基本報告仍可閱讀。'};}
}
