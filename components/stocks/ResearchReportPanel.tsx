'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Download } from 'lucide-react';
import { generateResearchReport, getResearchReports } from '@/lib/actions/research-report.actions';
import type { PublishedResearchReport } from '@/lib/analysis/types';
import { mergeReportHistory } from '@/lib/analysis/history';
import ResearchReportView from './ResearchReportView';

export default function ResearchReportPanel({ symbol }: { symbol: string }) {
    const [reports, setReports] = useState<PublishedResearchReport[]>([]);
    const [selected, setSelected] = useState('');
    const [loadedFor, setLoadedFor] = useState(symbol);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const sequence = useRef(0);
    const invalidate = useCallback(() => ++sequence.current, []);
    const [readAttempt, setReadAttempt] = useState(0);
    useEffect(() => {
        const request = invalidate();
        setLoading(true); setGenerating(false); setError(null); setNotice(null);
        getResearchReports(symbol).then(result => {
            if (request !== sequence.current) return;
            if (result.ok) { setReports(result.reports); setSelected(result.reports[0]?.id ?? ''); setLoadedFor(symbol); }
            else setError(result.message);
        }).catch(() => { if (request === sequence.current) setError('研究報告暫時無法讀取，請重試。'); })
            .finally(() => { if (request === sequence.current) setLoading(false); });
        return () => { invalidate(); };
    }, [symbol, readAttempt, invalidate]);
    const visible = loadedFor === symbol ? reports : [];
    const report = visible.find(r => r.id === selected) ?? visible[0];
    const generate = async () => {
        if (generating || loading) return;
        const request = ++sequence.current;
        setGenerating(true); setError(null); setNotice(null);
        try {
            const result = await generateResearchReport(symbol);
            if (request !== sequence.current) return;
            if (result.ok) {
                setReports(previous => mergeReportHistory(previous, result.report));
                setSelected(result.report.id); setLoadedFor(symbol);
                setNotice(result.reused ? '資料與參數未變，沿用已保存的報告。' : '研究報告已完整保存。');
            } else setError(result.message);
        } catch { if (request === sequence.current) setError('報告產生失敗，既有報告仍可閱讀，請稍後重試。'); }
        finally { if (request === sequence.current) setGenerating(false); }
    };
    const download = () => {
        if (!report) return;
        const url = URL.createObjectURL(new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url;
        anchor.download = `${report.snapshot.symbol.replace(/[^a-z0-9_-]/gi, '_')}_${report.snapshot.dataDate}_研究報告.md`;
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return <section className="card mt-3 overflow-hidden" aria-label="自動研究報告">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <div><h2 className="flex items-center gap-2 text-sm font-bold"><FileText className="size-4 text-brand-ink" />自動研究報告</h2><p className="mt-1 text-[11px] text-faint">日 K · 有證據的規則式分析 · 按需產生</p></div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={generate} disabled={loading || generating}>
                {generating && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}{generating ? '報告產生中…' : '產生分析報告'}
            </button>
        </header>
        <div className="px-4 sm:px-5">
            {loading && <p className="py-4 text-xs text-faint" role="status">讀取已保存報告…</p>}
            {error && <div className="my-3 rounded-lg border border-line p-3 text-xs" role="alert"><p>{error}</p><button type="button" className="mt-2 underline underline-offset-4" onClick={() => setReadAttempt(n => n + 1)} disabled={generating}>重新讀取已保存報告</button></div>}
            {notice && <p className="py-3 text-xs text-faint" role="status">{notice}</p>}
            {!loading && !error && !report && <p className="py-5 text-[13px] leading-relaxed text-faint">尚無已保存報告。按「產生分析報告」整合技術方向、多空證據與風險；不提供模型機率。</p>}
            {report && <>
                <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <label className="text-xs text-faint">已保存版本 <select className="ml-2 rounded border border-line bg-transparent px-2 py-1 text-foreground" value={report.id} onChange={e => setSelected(e.target.value)} disabled={generating}>
                        {visible.map(r => <option key={r.id} value={r.id}>{r.snapshot.dataDate} · {new Date(r.publishedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}</option>)}
                    </select></label>
                    <button type="button" className="inline-flex items-center gap-1.5 text-xs text-faint hover:text-foreground" onClick={download}><Download className="size-3.5" />下載 Markdown</button>
                </div><ResearchReportView report={report} />
            </>}
        </div>
    </section>;
}
