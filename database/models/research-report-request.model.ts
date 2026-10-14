import { Schema, model, models } from 'mongoose';
const schema = new Schema({
    userId: { type: String, required: true }, token: { type: String, required: true },
    availableAt: { type: Date, required: true }, lockedUntil: { type: Date, required: true }, expiresAt: { type: Date, required: true },
}, { collection: 'research_report_requests' });
schema.index({ userId: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const ResearchReportRequestModel = models.ResearchReportRequest || model('ResearchReportRequest', schema);
