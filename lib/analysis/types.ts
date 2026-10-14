import type { CandleSource } from '@/lib/candles/types';
import type { Candle, IndicatorResult, IDSResult } from '@/lib/indicators/types';
import type { FourFactors } from '@/lib/indicators/factors';
import type { FactorPreference, FactorPeriods, FactorMarket } from '@/lib/indicators/factor-periods';
import type { IDSFactorResult, IDSPeriodResult } from '@/lib/indicators/ids';

export type ObservationDirection = 'bullish' | 'bearish' | 'range' | 'insufficient';
export type ObservationId = 'short' | 'medium' | 'long';
export interface ResearchProfile {
    id: ObservationId; label: string; periods: FactorPeriods; factors: FourFactors; ids: IDSFactorResult;
}
export interface SnapshotInput {
    symbol: string; source: CandleSource; candles: Candle[]; benchmark?: Candle[] | null;
    preference: FactorPreference; volumeComplete?: boolean; now: Date; sourceCommit?: string; contextWarnings?: string[];
}
export interface ResearchSnapshot {
    schemaVersion: 1; engineVersion: string; sourceCommit: string; inputHash: string;
    symbol: string; market: FactorMarket; interval: '1d'; source: CandleSource;
    asof: string; dataDate: string; generatedAt: string; referencePrice: number; candleCount: number;
    preference: FactorPreference; indicators: IndicatorResult[]; ids: IDSResult;
    factors: FourFactors; idsFactor: IDSFactorResult;
    idsPeriod: Record<string, IDSPeriodResult & { nullReason: 'insufficient-data' | 'all-neutral' | 'non-directional' | null }>;
    profiles: ResearchProfile[]; warnings: string[];
    quality: { state: 'complete' | 'limited'; availableIndicators: number; totalIndicators: number; volumeComplete: boolean };
}
export interface ResearchAnalysis {
    rulesVersion: string; headline: string;
    directions: { id: ObservationId; label: string; direction: ObservationDirection; periods: FactorPeriods; reason: string }[];
    evidence: { bullish: IndicatorResult[]; bearish: IndicatorResult[] };
    conflicts: string[]; risks: string[]; idsSummary: string;
    levels: { indicatorId: string; name: string; value: number; role: 'support' | 'resistance' | 'reference' }[];
    scenarios: { id: 'bullish' | 'range' | 'bearish'; title: string; conditions: string[] }[];
}
export interface PublishedResearchReport {
    id: string; snapshot: ResearchSnapshot; analysis: ResearchAnalysis; markdown: string; publishedAt: string;
}
export type ResearchErrorCode = 'unauthorized' | 'unsupported-symbol' | 'busy' | 'no-data' | 'api-error' | 'persistence-error';
export type ResearchGenerationResult = { ok: true; report: PublishedResearchReport; reused: boolean }
    | { ok: false; code: ResearchErrorCode; message: string };
