import { Schema, model, models, type Model } from 'mongoose';
import type { PublishedResearchReport } from '@/lib/analysis/types';
interface ResearchReportDocument {
    userId: string; symbol: string; inputHash: string; rulesVersion: string; publishedAt: string; report: PublishedResearchReport;
}
const schema = new Schema<ResearchReportDocument>({
    userId: { type: String, required: true }, symbol: { type: String, required: true },
    inputHash: { type: String, required: true }, rulesVersion: { type: String, required: true },
    publishedAt: { type: String, required: true }, report: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true, collection: 'research_reports' });
schema.index({ userId: 1, symbol: 1, inputHash: 1, rulesVersion: 1 }, { unique: true });
schema.index({ userId: 1, symbol: 1, publishedAt: -1 });
export const ResearchReportModel: Model<ResearchReportDocument> = (models.ResearchReport as Model<ResearchReportDocument>) || model<ResearchReportDocument>('ResearchReport', schema);
