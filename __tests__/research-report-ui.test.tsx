import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ResearchReportView from '@/components/stocks/ResearchReportView';
import ResearchReportPanel from '@/components/stocks/ResearchReportPanel';
import { createResearchSnapshot } from '@/lib/analysis/snapshot';
import { analyzeResearch } from '@/lib/analysis/engine';
import { renderResearchMarkdown } from '@/lib/analysis/template';
import { defaultFactorPreference } from '@/lib/indicators/factor-periods';
vi.mock('@/lib/actions/research-report.actions', () => ({ getResearchReports: vi.fn(), generateResearchReport: vi.fn() }));
describe('research report UI', () => {
    it('renders the nine sections, technical horizons and traceable source without probability claims', () => {
        const snapshot = createResearchSnapshot({ symbol: 'TWSE:2330', source: { provider: 'twse', symbol: '2330', timeZone: 'Asia/Taipei', priceBasis: 'unadjusted' },
            candles: Array.from({ length: 430 }, (_, i) => ({ t: Date.parse('2026-10-14T00:00:00Z') / 1000 - (429 - i) * 86400, o: 100 + i, h: 104 + i, l: 99 + i, c: 103 + i, v: 1000 })),
            preference: defaultFactorPreference('taiwan'), now: new Date('2026-10-15T12:00:00Z') });
        const analysis = analyzeResearch(snapshot);
        const html = renderToStaticMarkup(<ResearchReportView report={{ id: 'report-1', snapshot, analysis, markdown: renderResearchMarkdown(snapshot, analysis), publishedAt: snapshot.generatedAt }} />);
        for (const title of ['報告基本資料', '綜合研判摘要', '四因素分析', 'IDS 分歧分析', '核心多空證據', '支撐、壓力與觀察價位', '情境推演', '風險與資料品質聲明', '追溯資訊']) expect(html).toContain(title);
        expect(html).toContain('短線技術'); expect(html).toContain('未調整價'); expect(html).toContain('research-rules-v1');
        expect(html).toContain(snapshot.inputHash); expect(html).not.toMatch(/上漲機率\s*\d/);
    });
    it('shows on-demand generation without running it during initial render', async () => {
        const action = await import('@/lib/actions/research-report.actions');
        const html = renderToStaticMarkup(<ResearchReportPanel symbol="2330.TW" />);
        expect(html).toContain('產生分析報告'); expect(html).toContain('自動研究報告');
        expect(action.generateResearchReport).not.toHaveBeenCalled();
    });
});
