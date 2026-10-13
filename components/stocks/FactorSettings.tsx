'use client';

import { useRef, useState } from 'react';
import { getFourFactorAssessmentWithReason, type AssessmentFailureReason, type FourFactorAssessment } from '@/lib/actions/indicators.actions';
import { saveFactorPreference } from '@/lib/actions/factor-preferences.actions';
import { parseFactorPreference, presetFactorPreference, type CryptoInterval, type FactorPreference } from '@/lib/indicators/factor-periods';
import type { FactorId } from '@/lib/indicators/factors';
import FactorCards from './FactorCards';

type FactorResponse = {
    assessment: FourFactorAssessment | null;
    reason: AssessmentFailureReason | null;
    candleCount: number;
};
type FactorStatus = 'idle' | 'preview' | 'saved' | 'error';
type FactorUpdateResult = { preference: FactorPreference; saved: boolean; response: FactorResponse | null; error: 'save' | 'refresh' | null };

export function isRetryableFactorFailure(result: FactorUpdateResult): boolean {
    if (result.error === 'refresh') return true;
    return result.error === null && result.response?.assessment === null &&
        result.response.reason !== 'invalid-preference' && result.response.reason !== 'unsupported-symbol';
}

export function factorFeedback(status: FactorStatus, message: string): string {
    const saved = '已儲存；同市場其他標的會沿用此偏好。';
    const preview = '暫時預覽：只套用於目前頁面，尚未儲存。';
    const prefix = status === 'saved' ? saved : status === 'preview' ? preview : '';
    return prefix ? `${prefix}${message ? ` ${message}` : ''}` : message;
}

/** 編輯請求進行中時保留提交時的草稿快照。 */
export function editFactorDraft(current: FactorPreference, next: FactorPreference, busy: boolean): FactorPreference {
    return busy ? current : next;
}

/** 將儲存與評分刷新分成兩個失敗邊界，避免儲存成功被誤報為失敗。 */
export async function runFactorUpdate(
    preference: FactorPreference,
    save: ((value: FactorPreference) => Promise<FactorPreference>) | null,
    refresh: (value: FactorPreference) => Promise<FactorResponse>,
): Promise<FactorUpdateResult> {
    let applied = preference;
    if (save) {
        try {
            applied = await save(preference);
        } catch {
            return { preference, saved: false, response: null, error: 'save' };
        }
    }
    try {
        return { preference: applied, saved: Boolean(save), response: await refresh(applied), error: null };
    } catch {
        return { preference: applied, saved: Boolean(save), response: null, error: 'refresh' };
    }
}

const FACTORS: { id: FactorId; label: string }[] = [
    { id: 'T', label: '趨勢 T' }, { id: 'M', label: '動能 M' },
    { id: 'V', label: '量能 V' }, { id: 'R', label: '風險 R' },
];
const PRESETS = ['short', 'medium', 'long'] as const;
const INTERVALS: CryptoInterval[] = ['4h', '8h', '12h', '1d'];
const FAILURE: Record<AssessmentFailureReason, string> = {
    'invalid-preference': '四因素設定無效，請檢查期間與週期。',
    'api-error': '四因素行情服務暫時無法使用，請稍後重試。',
    'missing-config': '四因素行情來源尚未設定完成。',
    'unsupported-symbol': '目前尚未支援此標的的四因素資料。',
    'no-data': '查無可用的四因素歷史資料。',
    'insufficient-data': '四因素歷史資料不足。',
};

export default function FactorSettings({ symbol, initialPreference, initialResponse, readError, initialSaved }: {
    symbol: string;
    initialPreference: FactorPreference | null;
    initialResponse: FactorResponse;
    readError: boolean;
    initialSaved: boolean;
}) {
    const [draft, setDraft] = useState<FactorPreference | null>(initialPreference);
    const [shown, setShown] = useState(initialResponse);
    const [status, setStatus] = useState<FactorStatus>(initialSaved ? 'saved' : 'idle');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [readWarning, setReadWarning] = useState(readError);
    const [retryPreference, setRetryPreference] = useState<FactorPreference | null>(null);
    const requestId = useRef(0);
    const max = draft?.market === 'crypto' ? 180 : 126;

    function updatePeriod(id: FactorId, value: string) {
        if (!draft || busy) return;
        setDraft(current => current && editFactorDraft(current, { ...current, preset: 'custom', periods: { ...current.periods, [id]: value === '' ? NaN : Number(value) } }, busy));
        setStatus('idle');
        setMessage('');
        setRetryPreference(null);
    }

    function selectPreset(preset: typeof PRESETS[number]) {
        if (!draft || busy) return;
        setDraft(current => current && editFactorDraft(current, presetFactorPreference(current.market, preset, current.interval ?? undefined), busy));
        setStatus('idle');
        setMessage('');
        setRetryPreference(null);
    }

    function selectInterval(interval: CryptoInterval) {
        if (!draft || busy) return;
        setDraft(current => current && editFactorDraft(current, { ...current, interval }, busy));
        setStatus('idle');
        setMessage('');
        setRetryPreference(null);
    }

    async function apply(save: boolean) {
        if (!draft || busy) return;
        let valid: FactorPreference;
        try {
            valid = parseFactorPreference(draft.market, draft);
        } catch {
            setStatus('error');
            setMessage(FAILURE['invalid-preference']);
            return;
        }
        const currentRequest = ++requestId.current;
        setBusy(true);
        setMessage('');
        try {
            const outcome = await runFactorUpdate(valid,
                save ? value => saveFactorPreference(symbol, value) : null,
                value => getFourFactorAssessmentWithReason(symbol, value));
            if (currentRequest !== requestId.current) return;
            if (outcome.error === 'save') {
                setStatus('error');
                setMessage('儲存失敗，草稿已保留，請稍後重試。');
                return;
            }
            if (outcome.saved) setReadWarning(false);
            setDraft(outcome.preference);
            setStatus(save ? 'saved' : 'preview');
            if (outcome.error === 'refresh') {
                setRetryPreference(outcome.preference);
                setMessage(save ? '評分更新失敗。請按「重新整理評分」重試。' : '預覽評分更新失敗。請按「重新整理評分」重試。');
                return;
            }
            setRetryPreference(isRetryableFactorFailure(outcome) ? outcome.preference : null);
            if (outcome.response) {
                setShown(outcome.response);
                if (outcome.response.reason) setMessage(FAILURE[outcome.response.reason]);
            }
        } finally {
            if (currentRequest === requestId.current) setBusy(false);
        }
    }

    async function retryAssessment() {
        if (!retryPreference || busy) return;
        const currentRequest = ++requestId.current;
        setBusy(true);
        try {
            const outcome = await runFactorUpdate(retryPreference, null,
                value => getFourFactorAssessmentWithReason(symbol, value));
            if (currentRequest !== requestId.current) return;
            if (outcome.error === 'refresh') {
                setMessage('評分更新仍失敗，請稍後重新整理評分。');
                return;
            }
            if (outcome.response) {
                setShown(outcome.response);
                setRetryPreference(isRetryableFactorFailure(outcome) ? outcome.preference : null);
                setMessage(outcome.response.reason ? FAILURE[outcome.response.reason] : '評分已更新。');
            }
        } catch {
            if (currentRequest !== requestId.current) return;
            setStatus('error');
            setMessage('評分更新失敗，請稍後重試。');
        } finally {
            if (currentRequest === requestId.current) setBusy(false);
        }
    }

    return (
        <section className="border-t border-line" aria-label="四因素設定與評分">
            {!draft && <p className="px-3 pt-3 text-[11.5px] text-faint">國際市場沿用固定日 K、四因素 n=14。</p>}
            {draft && (
                <div className="px-3 pt-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-1.5">
                        <h3 className="text-[13px] font-bold text-foreground">四因素期間設定</h3>
                        <span className="text-[11px] text-faint">{draft.market === 'crypto' ? '加密貨幣' : draft.market === 'taiwan' ? '台股' : '美股'}市場偏好</span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
                        {draft.preset === 'legacy' && draft.interval === (draft.market === 'crypto' ? '1d' : null)
                            ? '現行預設：四因素皆 n=14，crypto 使用 1d。'
                            : '選擇預設或分別調整四個因素；預覽只影響目前頁面。'}
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="期間預設">
                        {PRESETS.map(preset => {
                            const n = draft.market === 'crypto'
                                ? { short: 10, medium: 30, long: 180 }[preset]
                                : { short: 7, medium: 21, long: 126 }[preset];
                            return <button key={preset} type="button" disabled={busy} onClick={() => selectPreset(preset)}
                                aria-pressed={draft.preset === preset}
                                className={`min-h-11 rounded-lg border px-1 py-2 text-[12px] font-bold transition-colors ${draft.preset === preset ? 'border-gold bg-gold/15 text-gold' : 'border-line text-faint hover:bg-hover/50 hover:text-foreground'}`}>
                                {({ short: '短期', medium: '中期', long: '長期' } as const)[preset]} <span className="num">{n}</span>
                            </button>;
                        })}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {FACTORS.map(({ id, label }) => <label key={id} className="min-w-0 text-[11px] font-semibold text-faint">
                            <span className="mb-1 block">{label} · N</span>
                            <input type="number" inputMode="numeric" min={5} max={max} step={1} disabled={busy} value={Number.isNaN(draft.periods[id]) ? '' : draft.periods[id]}
                                onChange={event => updatePeriod(id, event.target.value)}
                                className="num h-11 w-full min-w-0 rounded-lg border border-line bg-card px-3 text-[16px] font-semibold text-foreground focus:border-gold focus:outline-none" />
                        </label>)}
                    </div>
                    <p className="mt-1 text-[11px] text-faint">N 可設 5–{max}，需為整數。</p>
                    {draft.market === 'crypto' && (
                        <div className="mt-3">
                            <p className="mb-1 text-[11px] font-semibold text-faint">四因素 K 線週期</p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="加密貨幣週期">
                                {INTERVALS.map(interval => <button key={interval} type="button" disabled={busy} onClick={() => selectInterval(interval)}
                                    aria-pressed={draft.interval === interval}
                                    className={`num min-h-11 rounded-lg border px-2 py-2 text-[13px] font-bold transition-colors ${draft.interval === interval ? 'border-gold bg-gold/15 text-gold' : 'border-line text-faint hover:bg-hover/50 hover:text-foreground'}`}>
                                    {interval}
                                </button>)}
                            </div>
                        </div>
                    )}
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button type="button" disabled={busy} onClick={() => apply(false)} className="min-h-11 w-full rounded-lg border border-gold px-3 text-[13px] font-bold text-gold transition-colors hover:bg-gold/10 disabled:opacity-50">{busy ? '處理中…' : '暫時套用'}</button>
                        <button type="button" disabled={busy} onClick={() => apply(true)} className="min-h-11 w-full rounded-lg bg-gold px-3 text-[13px] font-bold text-background transition-opacity hover:opacity-90 disabled:opacity-50">儲存市場偏好</button>
                    </div>
                    <p role="status" aria-live="polite" className="mt-2 min-h-5 text-[11.5px] text-faint">
                        {factorFeedback(status, message)}
                    </p>
                    {retryPreference && <button type="button" disabled={busy} onClick={retryAssessment} className="mb-2 min-h-11 w-full rounded-lg border border-line px-3 text-[13px] font-bold text-foreground hover:bg-hover/50 disabled:opacity-50">重新整理評分</button>}
                    {readWarning && <p className="mt-1 text-[11.5px] text-warn">偏好讀取失敗，暫以現行預設顯示；儲存前請確認設定。</p>}
                </div>
            )}
            {shown.assessment ? (
                <>
                    <FactorCards factors={shown.assessment.factors} assessment={shown.assessment} />
                    <div className="border-t border-line px-3 py-2.5">
                        <p className="text-[12px] font-bold text-foreground">IDS-Factor · 四因素分歧</p>
                        <p className="num mt-1 text-[22px] font-bold leading-none text-foreground">
                            {shown.assessment.idsFactor.idsPct === null ? 'N/A' : `${shown.assessment.idsFactor.idsPct.toFixed(1)}%`}
                        </p>
                        <p className="num mt-1 text-[11px] text-faint">n={shown.assessment.idsFactor.validCount}/3{shown.assessment.idsFactor.validCount === 1 ? ' · 證據不足' : ''}</p>
                    </div>
                </>
            ) : (
                <div className="px-3 pb-3 pt-2" role="alert">
                    <p className="kicker">四因素評分</p>
                    <p className="mt-1 text-[12px] text-faint">{shown.reason ? FAILURE[shown.reason] : '目前無法計算四因素。'}</p>
                </div>
            )}
        </section>
    );
}
