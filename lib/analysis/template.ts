import { DIRECTION_LABELS } from './engine';
import type { ResearchAnalysis, ResearchSnapshot } from './types';
const number = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? 'N/A' : v.toFixed(2);
const bullets = (values: string[]) => values.length ? values.map(s => `- ${s}`).join('\n') : '- 無可用資料（N/A）';
export function renderResearchMarkdown(s: ResearchSnapshot, a: ResearchAnalysis): string {
    const evidence = (side: 'bullish' | 'bearish') => a.evidence[side].map(r => `${r.name} [${r.id}]：${number(r.value)}；${r.reason}`);
    return `# ${s.symbol} 自動研究報告\n\n` + [
        `## 1. 報告基本資料\n標的：${s.symbol}；市場：${s.market}；資料日期：${s.dataDate}；參考收盤：${number(s.referencePrice)}。\n來源：${s.source.provider} / ${s.source.symbol}；日 K；${s.source.priceBasis === 'unadjusted' ? '未調整價' : '依來源價格口徑'}；品質：${s.quality.state === 'complete' ? '完整計算' : '資料受限'}。`,
        `## 2. 綜合研判摘要\n${a.headline}。\n${bullets(a.directions.map(d => `${d.label}：${DIRECTION_LABELS[d.direction]}；T${d.periods.T}/M${d.periods.M}/V${d.periods.V}/R${d.periods.R} 根日 K。${d.reason}`))}\n短中長線是技術參數組，不是未來報酬期限。`,
        `## 3. 四因素分析\n${bullets((['T', 'M', 'V', 'R'] as const).map(id => `${id}（N=${s.factors[id].n}）：${id === 'R' ? `ATR% ${number(s.factors.R.atrPct)}；歷史分位 ${number(s.factors.R.score)}` : number(s.factors[id].score)}；${s.factors[id].reason}`))}\nT 為 ATR 倍數；M/V 為指標分數；R 不投方向票。`,
        `## 4. IDS 分歧分析\n${a.idsSummary}\n方向覆蓋率：${number(s.ids.coveragePct)}；方向熵：${number(s.ids.entropyPct)}；有效指標 ${s.quality.availableIndicators}/${s.quality.totalIndicators}。\n${bullets(Object.entries(s.idsPeriod).map(([id, v]) => `IDS-Period ${id}：${number(v.idsPct)}；${v.validCount} 個有效期間；${v.nullReason === 'non-directional' ? '此指標無方向票' : v.nullReason === 'all-neutral' ? '有效期間全為中立' : v.nullReason === 'insufficient-data' ? '資料不足' : '有方向票'}`))}\nIDS-Factor：${number(s.idsFactor.idsPct)}；${s.idsFactor.validCount}/3 有效方向因素。\n${bullets(a.conflicts)}`,
        `## 5. 核心多空證據\n### 支持上行\n${bullets(evidence('bullish'))}\n### 支持下行／反對訊號\n${bullets(evidence('bearish'))}\n沒有反向訊號也不代表沒有風險。`,
        `## 6. 支撐、壓力與觀察價位\n${bullets(a.levels.map(l => `${l.role === 'support' ? '下方支撐參考' : l.role === 'resistance' ? '上方壓力參考' : '參考位'} ${number(l.value)}：${l.name} [${l.indicatorId}]`))}\n價位依目前收盤相對位置分類，並非已驗證的未來目標價。`,
        `## 7. 情境推演\n${a.scenarios.map(c => `### ${c.title}\n${bullets(c.conditions)}`).join('\n')}\n情境均無預設機率。`,
        `## 8. 風險與資料品質聲明\n${bullets(a.risks)}\n規則與門檻尚未經預測回測校準；僅供研究參考。`,
        `## 9. 追溯資訊\n生成時間：${s.generatedAt}\n資料截止：${s.asof}\n輸入快照：${s.inputHash}\n引擎：${s.engineVersion}\n規則：${a.rulesVersion}\n來源程式版本：${s.sourceCommit}\n發布狀態：完整生成並成功保存後才發布。`,
    ].join('\n\n');
}
