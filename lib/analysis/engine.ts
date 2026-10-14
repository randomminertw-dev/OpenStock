import type { ObservationDirection, ResearchAnalysis, ResearchSnapshot } from './types';
export const RESEARCH_RULES_VERSION = 'research-rules-v1';
export const DIRECTION_LABELS: Record<ObservationDirection, string> = { bullish: '偏多', bearish: '偏空', range: '震盪', insufficient: '證據不足' };
// Only scalar outputs explicitly defined as price levels in the existing engines.
const PRICE_IDS = new Set(['ma60', 'sma200', 'supertrend', 'fib60', 'pivot', 'cpr', 'maenvelope20', 'camarilla', 'fractals']);
export function analyzeResearch(snapshot: ResearchSnapshot): ResearchAnalysis {
    const directions = snapshot.profiles.map(p => {
        let direction: ObservationDirection = 'insufficient';
        if (p.ids.validCount >= 2 && p.factors.T.score !== null) {
            const gap = (p.ids.upPct ?? 0) - (p.ids.downPct ?? 0);
            direction = gap > 10 ? 'bullish' : gap < -10 ? 'bearish' : 'range';
        }
        return { id: p.id, label: p.label, direction, periods: p.periods,
            reason: direction === 'insufficient' ? '趨勢或方向因素不足，無法確認此觀察週期。'
                : `依既有 T/M/V 方向票整合（${p.ids.validCount}/3 有效因素）；R 僅描述波動。` };
    });
    const valid = snapshot.indicators.filter(r => r.signal !== null);
    const bullish = valid.filter(r => r.signal === 1);
    const bearish = valid.filter(r => r.signal === -1);
    const conflicts: string[] = [];
    if (bullish.length && bearish.length) conflicts.push(`有效指標同時包含 ${bullish.length} 項看多與 ${bearish.length} 項看空，方向尚有分歧。`);
    if (new Set(directions.filter(d => d.direction !== 'insufficient').map(d => d.direction)).size > 1) conflicts.push('短、中、長線的技術方向不同，不能以單一週期代表所有觀察。');
    for (const p of snapshot.profiles) if ((p.ids.upPct ?? 0) > 0 && (p.ids.downPct ?? 0) > 0) conflicts.push(`${p.label}的 T/M/V 存在反向證據，需等待趨勢、動能與量能確認。`);
    const risks = [...snapshot.warnings];
    const atr = snapshot.factors.R.atrPct;
    if (atr != null && Number.isFinite(atr)) risks.push(`當期 ATR% ${atr.toFixed(2)}%${atr >= 5 ? '，超過本版 5% 波動提醒門檻' : ''}；這是波幅，沒有多空方向。`);
    else risks.push('波動因素 ATR% 為 N/A，不能據此宣稱低風險。');
    if (snapshot.factors.T.score === null) risks.push('T 趨勢因素無法定義（可能為資料不足或 ATR 為零），詳見原始因素說明。');
    const idsSummary = snapshot.ids.idsPct === null
        ? valid.length ? '有效指標沒有方向票（全中立）；IDS 為 N/A，不等於零分歧。' : '無有效指標，IDS 與共識度為 N/A。'
        : `IDS 分歧 ${snapshot.ids.idsPct.toFixed(1)}，共識度 ${snapshot.ids.consensusPct!.toFixed(1)}；一致不代表預測準確。`;
    const levels = snapshot.indicators.filter(r => PRICE_IDS.has(r.id) && r.signal !== null && r.value !== null && Number.isFinite(r.value) && r.value > 0)
        .map(r => ({ indicatorId: r.id, name: r.name, value: r.value!, role: (r.value! < snapshot.referencePrice ? 'support' : r.value! > snapshot.referencePrice ? 'resistance' : 'reference') as 'support' | 'resistance' | 'reference' }))
        .sort((a, b) => a.value - b.value);
    const support = levels.filter(l => l.role === 'support').at(-1);
    const resistance = levels.find(l => l.role === 'resistance');
    const scenarios: ResearchAnalysis['scenarios'] = [
        { id: 'bullish', title: '偏多條件', conditions: [resistance ? `後續完整日 K 收盤站上 ${resistance.value.toFixed(2)}（${resistance.name}），並由動能、量能同步確認。` : '尚無有效上方技術價位，等待趨勢、動能與量能同步轉強。'] },
        { id: 'range', title: '震盪條件', conditions: ['若指標持續分歧，且未有方向性的價量確認，維持震盪／尚未確認的觀察。'] },
        { id: 'bearish', title: '偏空條件', conditions: [support ? `後續完整日 K 收盤跌破 ${support.value.toFixed(2)}（${support.name}），並伴隨動能轉弱，需重新檢視下行風險。` : '尚無有效下方技術價位；若趨勢、動能與量能同步轉弱，需重新檢視下行風險。'] },
    ];
    risks.push('本報告採規則式技術觀察，未提供模型機率；技術價位不保證未來價格。');
    return { rulesVersion: RESEARCH_RULES_VERSION, headline: directions.map(d => `${d.label}${DIRECTION_LABELS[d.direction]}`).join('、'),
        directions, evidence: { bullish: bullish.slice(0, 5), bearish: bearish.slice(0, 5) }, conflicts, risks, idsSummary, levels, scenarios };
}
