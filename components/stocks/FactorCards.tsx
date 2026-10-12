import { TrendingUp, Minus, Zap, BarChart3, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FactorId, FactorScore, FourFactors } from '@/lib/indicators/factors';

const FACTOR_META: Record<FactorId, { name: string; hint: string; Icon: typeof TrendingUp }> = {
    T: { name: '趨勢', hint: '趨勢強度與方向', Icon: TrendingUp },
    M: { name: '動能', hint: '動能強度與方向', Icon: Zap },
    V: { name: '量能', hint: '資金流入強度', Icon: BarChart3 },
    R: { name: '波動風險', hint: '風險強度，不代表方向', Icon: ShieldAlert },
};

const ORDER: FactorId[] = ['T', 'M', 'V', 'R'];

function fmtScore(score: number): string {
    const body = Math.abs(score).toFixed(1);
    if (score > 0) return `+${body}`;
    if (score < 0) return `−${body}`;
    return '0.0';
}

function FactorCard({ factor }: { factor: FactorScore }) {
    const meta = FACTOR_META[factor.id];
    const isRisk = factor.id === 'R';
    const missing = factor.score === null || !Number.isFinite(factor.score);

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
        <div className="rounded-xl border border-line bg-card px-3 py-2.5">
            <div className="flex items-center gap-1.5">
                <Icon className="size-3.5 text-faint" />
                <p className="text-[12px] font-bold text-foreground">
                    {meta.name}
                    <span className="num ml-1 text-[11px] font-semibold text-faint">{factor.id}</span>
                </p>
            </div>

            <p className={cn('num mt-1.5 text-[26px] font-bold leading-none', scoreClass)}>
                {/* R 為 [0,100] 的強度分數，不帶正負號（無方向性） */}
                {missing ? 'N/A' : isRisk ? Math.abs(factor.score!).toFixed(1) : fmtScore(factor.score!)}
            </p>

            <p className="mt-1 text-[11px] leading-relaxed text-faint">{meta.hint}</p>

            {missing ? (
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{factor.reason}</p>
            ) : (
                <p className="num mt-1.5 text-[11px] text-faint">
                    n={factor.n}
                    <span className="ml-1.5">{factor.formulaVersion}</span>
                </p>
            )}
        </div>
    );
}

export default function FactorCards({ factors }: { factors: FourFactors }) {
    return (
        <div className="px-3 pb-1 pt-3">
            <div className="flex items-center justify-between gap-2">
                <p className="kicker">四因素評分</p>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ORDER.map((id) => (
                    <FactorCard key={id} factor={factors[id]} />
                ))}
            </div>

            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
                標準化技術分數，非預測機率。T / M / V 正值偏多、負值偏空；R 為波動風險強度（0–100），不代表方向。
            </p>
        </div>
    );
}
