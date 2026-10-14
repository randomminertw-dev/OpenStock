import { randomUUID } from 'node:crypto';
import { analyzeResearch, RESEARCH_RULES_VERSION } from './engine';
import { renderResearchMarkdown } from './template';
import type { ResearchReportRepository } from './repository';
import type { ResearchSnapshot, ResearchGenerationResult } from './types';
function finite(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    if (value && typeof value === 'object') return Object.values(value).every(finite);
    return true;
}
export function createResearchReportService({ repo, load, now = () => new Date() }: {
    repo: ResearchReportRepository; load: (symbol: string) => Promise<ResearchSnapshot>; now?: () => Date;
}) {
    return {
        async list(owner: string, symbol: string) { return repo.list(owner, symbol); },
        async generate(owner: string, symbol: string): Promise<ResearchGenerationResult> {
            const token = randomUUID(); let claimed = false; let stage = 'storage';
            try {
                claimed = await repo.claim(owner, token, now());
                if (!claimed) return { ok: false, code: 'busy', message: '報告產生中或尚在 60 秒冷卻時間，請稍後重試。' };
                stage = 'source';
                const snapshot = await load(symbol);
                if (snapshot.symbol !== symbol || !finite(snapshot)) throw new Error('Invalid snapshot');
                stage = 'storage';
                const existing = await repo.find(owner, symbol, snapshot.inputHash, RESEARCH_RULES_VERSION);
                if (existing) return { ok: true, report: existing, reused: true };
                stage = 'analysis';
                const analysis = analyzeResearch(snapshot);
                const markdown = renderResearchMarkdown(snapshot, analysis);
                const report = { id: randomUUID(), snapshot, analysis, markdown, publishedAt: now().toISOString() };
                if (!finite(report) || Buffer.byteLength(JSON.stringify(report)) > 256 * 1024) throw new Error('Invalid report size or values');
                stage = 'storage';
                return { ok: true, report: await repo.save(owner, report, token), reused: false };
            } catch (error) {
                const noData = (error as { reason?: string }).reason === 'no-data';
                return { ok: false, code: stage === 'storage' ? 'persistence-error' : noData ? 'no-data' : 'api-error',
                    message: stage === 'storage' ? '研究報告無法保存，未發布新版；既有報告仍可閱讀。' : noData ? '尚無可用的完整日 K，未產生新版報告。' : '行情或分析資料暫時無法使用，未發布新版；請稍後重試。' };
            } finally { if (claimed) await repo.release(owner, token).catch(() => {}); }
        },
    };
}
