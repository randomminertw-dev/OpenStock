import type { ReactNode } from 'react';
import type { PublishedResearchReport } from '@/lib/analysis/types';
import { DIRECTION_LABELS } from '@/lib/analysis/engine';
const fmt = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? 'N/A' : v.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const nullLabels = { 'insufficient-data': '資料不足', 'all-neutral': '全中立', 'non-directional': '波幅無方向' };
function Section({ title, children }: { title: string; children: ReactNode }) {
    return <section className="border-t border-line py-5"><h3 className="mb-3 text-sm font-bold text-foreground">{title}</h3>{children}</section>;
}
function Lines({ lines }: { lines: string[] }) {
    return lines.length ? <ul className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">{lines.map((line, i) => <li className="flex gap-2" key={i}><span className="text-faint" aria-hidden>·</span><span>{line}</span></li>)}</ul>
        : <p className="text-xs text-faint">無可用資料（N/A）</p>;
}
export default function ResearchReportView({ report }: { report: PublishedResearchReport }) {
    const { snapshot: s, analysis: a } = report;
    return <article aria-label={`${s.symbol} 研究報告`} className="min-w-0">
        <Section title="1. 報告基本資料">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2"><strong className="mono text-lg">{s.symbol}</strong><span className="num text-2xl font-bold">{fmt(s.referencePrice)}</span><span className="text-xs text-faint">參考收盤 · {s.dataDate}</span></div>
            <p className="mt-2 text-xs leading-relaxed text-faint">{s.source.provider} · {s.source.symbol} · 日 K · {s.source.priceBasis === 'unadjusted' ? '未調整價' : '依來源價格口徑'} · {s.candleCount} 根 K 線</p>
            {s.quality.state === 'limited' && <p className="mt-2 text-xs font-semibold text-brand-ink">資料受限：請連同第 8 節警語閱讀。</p>}
        </Section>
        <Section title="2. 綜合研判摘要">
            <p className="mb-4 text-base font-semibold leading-relaxed">{a.headline}。</p>
            <div className="grid gap-2 sm:grid-cols-3">{a.directions.map(d => <div key={d.id} className="rounded-xl border border-line bg-hover/20 p-3">
                <p className="kicker">{d.label}</p><p className={`mt-2 text-lg font-bold ${d.direction === 'bullish' ? 'text-up' : d.direction === 'bearish' ? 'text-down' : 'text-muted-foreground'}`}>{DIRECTION_LABELS[d.direction]}</p>
                <p className="num mt-2 text-[10px] text-faint">T{d.periods.T} / M{d.periods.M} / V{d.periods.V} / R{d.periods.R}</p><p className="mt-2 text-[11px] leading-relaxed text-faint">{d.reason}</p>
            </div>)}</div><p className="mt-3 text-xs text-faint">短中長線是技術參數組；N 代表日 K 根數，不是未來報酬期限。</p>
        </Section>
        <Section title="3. 四因素分析">
            <div className="grid gap-2 sm:grid-cols-2">{(['T', 'M', 'V', 'R'] as const).map(id => <div key={id} className="rounded-xl border border-line p-3">
                <p className="text-xs font-semibold">{id} · N={s.factors[id].n}</p><p className="num mt-1 text-lg font-bold">{id === 'R' ? `${fmt(s.factors.R.atrPct)}${s.factors.R.atrPct == null ? '' : '%'}` : fmt(s.factors[id].score)}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-faint">{s.factors[id].reason}</p>
            </div>)}</div><p className="mt-3 text-xs text-faint">T 為 ATR 倍數，M/V 為指標分數；R 主值為 ATR%，僅描述風險、不投方向票。此區使用帳號的因素 N，三種觀察組使用標準 N。</p>
        </Section>
        <Section title="4. IDS 分歧分析"><p className="mb-3 text-[13px] leading-relaxed">{a.idsSummary}</p>
            <p className="num mb-3 text-xs text-faint">方向覆蓋率 {fmt(s.ids.coveragePct)} · 方向熵 {fmt(s.ids.entropyPct)} · 有效指標 {s.quality.availableIndicators}/{s.quality.totalIndicators}</p>
            <ul className="mb-3 space-y-1 text-xs text-muted-foreground">{Object.entries(s.idsPeriod).map(([id, p]) => <li key={id}>IDS-Period {id}：{p.nullReason ? nullLabels[p.nullReason] : fmt(p.idsPct)} · {p.validCount}/5 有效期間</li>)}<li>IDS-Factor：{fmt(s.idsFactor.idsPct)} · {s.idsFactor.validCount}/3 有效因素</li></ul>
            <Lines lines={a.conflicts.length ? a.conflicts : ['目前有效證據未形成明顯反向分歧；這不代表預測一定準確。']} />
        </Section>
        <Section title="5. 核心多空證據"><div className="grid gap-4 sm:grid-cols-2">{(['bullish', 'bearish'] as const).map(side => <div key={side}>
            <h4 className="mb-2 text-xs font-semibold">{side === 'bullish' ? '支持上行' : '支持下行／反對訊號'}</h4><Lines lines={a.evidence[side].map(r => `${r.name} [${r.id}] ${fmt(r.value)}：${r.reason}`)} />
        </div>)}</div><p className="mt-3 text-xs text-faint">沒有反向訊號也不代表沒有風險。</p>
            <details className="mt-4 text-xs"><summary className="cursor-pointer text-faint">查看全部指標的原始證據</summary><ul className="mt-2 divide-y divide-line">{s.indicators.map(r => <li className="py-2 leading-relaxed" key={r.id}>{r.name} [{r.id}]：{fmt(r.value)} · {r.signal === null ? 'N/A' : r.signal === 1 ? '看多' : r.signal === -1 ? '看空' : '中立'}<br /><span className="text-faint">{r.reason}</span></li>)}</ul></details>
        </Section>
        <Section title="6. 支撐、壓力與觀察價位">
            {a.levels.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">有明確價格定義的技術觀察位</caption><thead><tr className="text-faint"><th className="pb-2">位置</th><th>價格</th><th>來源</th></tr></thead><tbody>{a.levels.map(l => <tr className="border-t border-line" key={l.indicatorId}><td className="py-2">{l.role === 'support' ? '下方支撐參考' : l.role === 'resistance' ? '上方壓力參考' : '參考位'}</td><td className="num pr-3">{fmt(l.value)}</td><td>{l.name} [{l.indicatorId}]</td></tr>)}</tbody></table></div> : <p className="text-xs text-faint">缺少已定義的有效價格指標，暫無可引用價位。</p>}
            <p className="mt-3 text-xs text-faint">依目前收盤相對位置分類，並非統計預測區間。</p>
        </Section>
        <Section title="7. 情境推演"><div className="space-y-4">{a.scenarios.map(c => <div key={c.id}><h4 className="mb-1 text-xs font-semibold">{c.title}</h4><Lines lines={c.conditions} /></div>)}</div><p className="mt-3 text-xs text-faint">所有情境均為條件式觀察，無預設機率。</p></Section>
        <Section title="8. 風險與資料品質聲明"><Lines lines={a.risks} /><p className="mt-3 text-xs text-faint">規則與門檻尚未經預測回測校準；僅供研究參考。</p></Section>
        <Section title="9. 追溯資訊"><dl className="space-y-2 break-all text-[11px] text-faint">{[
            ['資料截止', s.asof], ['生成時間', s.generatedAt], ['發布時間', report.publishedAt], ['輸入快照', s.inputHash],
            ['引擎／規則版本', `${s.engineVersion} / ${a.rulesVersion}`], ['來源程式版本', s.sourceCommit], ['報告 ID', report.id],
        ].map(([label, value]) => <div key={label}><dt className="font-semibold text-muted-foreground">{label}</dt><dd className="num mt-0.5">{value}</dd></div>)}</dl></Section>
    </article>;
}
