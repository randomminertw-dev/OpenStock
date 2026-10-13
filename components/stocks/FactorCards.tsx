import { TrendingUp, Minus, Zap, BarChart3, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FactorId, FactorScore, FourFactors } from '@/lib/indicators/factors';
import { trendWindows } from '@/lib/indicators/factors';
import type { FourFactorAssessment } from '@/lib/actions/indicators.actions';

const FACTOR_META: Record<FactorId, { name: string; hint: string; Icon: typeof TrendingUp }> = {
    T: { name: '趨勢', hint: '均線差距換算成 ATR 倍數；正值偏多、負值偏空，無上下限。', Icon: TrendingUp },
    M: { name: '動能', hint: 'RSI 轉成 −100～100 的方向分數；正值偏多、負值偏空。', Icon: Zap },
    V: { name: '量能', hint: 'CMF 轉成 −100～100 的資金流向分數；正值偏多、負值偏空。', Icon: BarChart3 },
    R: { name: '波動風險', hint: 'ATR% 是近期波幅相對收盤價的比例；歷史排名僅表示相對自身過去的位置。', Icon: ShieldAlert },
};

const ORDER: FactorId[] = ['T', 'M', 'V', 'R'];

function fmtScore(score: number): string {
    const body = Math.abs(score).toFixed(1);
    if (score > 0) return `+${body}`;
    if (score < 0) return `−${body}`;
    return '0.0';
}

function FactorCard({ factor, interval }: { factor: FactorScore; interval: FourFactorAssessment['interval'] }) {
    const meta = FACTOR_META[factor.id];
    const isRisk = factor.id === 'R';
    const missing = factor.score === null || !Number.isFinite(factor.score);
    const riskValueAvailable = isRisk && typeof factor.atrPct === 'number' && Number.isFinite(factor.atrPct);
    const riskRank = isRisk && !missing && factor.sampleCount !== undefined && factor.sampleCount > 1
        ? 1 + factor.score! * (factor.sampleCount - 1) / 100
        : null;

    // T/M/V 用方向配色；R 一律用琥珀中性色（不代表方向）
    const scoreClass = isRisk
        ? 'text-warn'
        : missing
          ? 'text-faint'
          : factor.score! > 0
            ? 'text-up'
            : factor.score! < 0
              ? 'text-down'
              : 'text-faint';

    const Icon = missing && !isRisk ? Minus : meta.Icon;

    return (
        <div className="min-w-0 rounded-xl border border-line bg-card px-3 py-2.5">
            <div className="flex items-center gap-1.5">
                <Icon className="size-3.5 text-faint" />
                <p className="text-[12px] font-bold text-foreground">
                    {meta.name}
                    <span className="num ml-1 text-[11px] font-semibold text-faint">{factor.id}</span>
                </p>
            </div>

            {isRisk && <p className="num mt-1.5 text-[11px] font-semibold text-faint">近期波動幅度 ATR%({factor.n})</p>}
            <p className={cn('num text-[26px] font-bold leading-none', isRisk ? 'mt-1' : 'mt-1.5', scoreClass)}>
                {isRisk ? (riskValueAvailable ? `${factor.atrPct!.toFixed(2)}%` : 'N/A') : missing ? 'N/A' : fmtScore(factor.score!)}
                {factor.id === 'T' && !missing && <span className="ml-1 text-[12px] font-semibold">倍 ATR</span>}
            </p>

            <p className="mt-1 text-[11px] leading-relaxed text-faint">{meta.hint}</p>
            {isRisk && riskValueAvailable && (
                <p className="num mt-1.5 text-[11px] leading-relaxed text-faint">
                    {missing
                        ? `歷史排名資料不足（${factor.sampleCount ?? 0}/126 筆）`
                        : `相對自身歷史：近 ${factor.sampleCount} 筆${factor.score === 0 ? '最低（百分位 0／100）' : `第 ${factor.score!.toFixed(1)} 百分位`}`}
                </p>
            )}
            {missing && !riskValueAvailable ? (
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{factor.reason}</p>
            ) : (
                <p className="num mt-1.5 text-[11px] text-faint">
                    n={factor.n}
                    <span className="ml-1.5">{factor.formulaVersion}</span>
                </p>
            )}
            {isRisk && factor.sampleCount !== undefined && (
                <p className="num mt-1 text-[11px] text-faint">R 分位樣本 {factor.sampleCount}</p>
            )}

            <details className="mt-2 border-t border-line pt-1">
                <summary className="min-h-11 cursor-pointer rounded-md py-3 text-[12px] font-semibold text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
                    公式與本次計算
                </summary>
                <div className="space-y-1.5 pb-1 text-[12px] leading-relaxed text-faint">
                    <p className="num">N={factor.n} 根 {interval} K 線</p>
                    {factor.id === 'T' && (
                        <>
                            <p className="num break-words">T = (SMA{trendWindows(factor.n).short} − SMA{trendWindows(factor.n).long}) ÷ ATR({factor.n})</p>
                            <p>波動率標準化均線乖離（Volatility-Adjusted Moving Average Spread）。ATR 以 Wilder 平滑真實波幅；結果有正負號，單位為倍 ATR。</p>
                        </>
                    )}
                    {factor.id === 'M' && (
                        <>
                            <p className="num break-words">M = 2 × RSI({factor.n}) − 100</p>
                            <p>RSI = 100 − 100 ÷ (1 + RS)；RS 為 Wilder 平均漲幅 ÷ 平均跌幅。</p>
                        </>
                    )}
                    {factor.id === 'V' && (
                        <>
                            <p className="num break-words">V = 100 × CMF({factor.n})</p>
                            <p>CMF = Σ(MFM × 成交量) ÷ Σ成交量；MFM = (2 × 收盤價 − 最高價 − 最低價) ÷ (最高價 − 最低價)。最高價等於最低價時，MFM 計為 0。</p>
                        </>
                    )}
                    {factor.id === 'R' && (
                        <>
                            <p className="num break-words">ATR%({factor.n}) = 100 × ATR({factor.n}) ÷ 收盤價</p>
                            <p className="num break-words">R = 100 × (平均名次 − 1) ÷ (樣本數 − 1)</p>
                            <p>以最多近 252 根有效 ATR% 排名（至少需 126 根）；不代表漲跌方向或預測機率。</p>
                        </>
                    )}
                    <p className="font-semibold text-foreground">本次計算</p>
                    {isRisk && riskValueAvailable && missing && (
                        <p className="num break-words">本次 ATR%({factor.n}) = {factor.atrPct!.toFixed(2)}%</p>
                    )}
                    <p className="break-words">{factor.reason}</p>
                    {riskRank !== null && (
                        <p className="num break-words">
                            100 × ({riskRank.toFixed(1)} − 1) ÷ ({factor.sampleCount} − 1) ≈ {factor.score!.toFixed(1)}
                        </p>
                    )}
                </div>
            </details>
        </div>
    );
}

export default function FactorCards({ factors, assessment }: { factors: FourFactors; assessment?: FourFactorAssessment }) {
    const timeZone = assessment?.source?.timeZone ?? 'UTC';
    return (
        <div className="px-3 pb-1 pt-3">
            <div className="flex items-center justify-between gap-2">
                <p className="kicker">四因素評分</p>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {ORDER.map((id) => (
                    <FactorCard key={id} factor={factors[id]} interval={assessment?.interval ?? '1d'} />
                ))}
            </div>

            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
                T 是帶方向的均線差（倍 ATR，不設 ±100 上限）；M / V 為標準化分數。正值偏多、負值偏空；R 主值為 ATR%，歷史排名僅供比較自身過去，不代表零風險、漲跌方向或預測機率。
            </p>
            {assessment && (
                <p className="num mt-1 text-[11px] leading-relaxed text-faint">
                    四因素週期 {assessment.interval} · asof {assessment.asof} · {timeZone}。跨市場不可直接比較。
                </p>
            )}
        </div>
    );
}
