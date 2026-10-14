import { connectToDatabase } from '@/database/mongoose';
import { ResearchReportModel } from '@/database/models/research-report.model';
import { ResearchReportRequestModel } from '@/database/models/research-report-request.model';
import type { PublishedResearchReport } from './types';
export interface ResearchReportRepository {
    list(owner: string, symbol: string): Promise<PublishedResearchReport[]>;
    find(owner: string, symbol: string, hash: string, rules: string): Promise<PublishedResearchReport | null>;
    save(owner: string, report: PublishedResearchReport, token: string): Promise<PublishedResearchReport>;
    claim(owner: string, token: string, now: Date): Promise<boolean>;
    release(owner: string, token: string): Promise<void>;
}
export function createResearchReportRepository(): ResearchReportRepository {
    return {
        async list(userId, symbol) {
            await connectToDatabase();
            const docs = await ResearchReportModel.find({ userId, symbol }).sort({ publishedAt: -1 }).limit(5).lean();
            return docs.map(doc => doc.report as PublishedResearchReport);
        },
        async find(userId, symbol, inputHash, rulesVersion) {
            await connectToDatabase();
            const doc = await ResearchReportModel.findOne({ userId, symbol, inputHash, rulesVersion }).lean();
            return doc?.report as PublishedResearchReport ?? null;
        },
        async save(userId, report, token) {
            const connection = await connectToDatabase();
            const session = await connection.startSession();
            const { symbol, inputHash } = report.snapshot;
            const { rulesVersion } = report.analysis;
            try {
                const saved = await session.withTransaction(async () => {
                    const now = new Date();
                    // Write the lease in the same transaction: a concurrent reclaim must
                    // conflict and retry, so an expired worker cannot publish afterwards.
                    const lease = await ResearchReportRequestModel.findOneAndUpdate(
                        { userId, token, lockedUntil: { $gt: now } },
                        { $set: { lockedUntil: new Date(now.getTime() + 120000) } }, { new: true, session });
                    if (!lease) throw new Error('Report generation lease expired');
                    const doc = await ResearchReportModel.findOneAndUpdate({ userId, symbol, inputHash, rulesVersion },
                        { $setOnInsert: { userId, symbol, inputHash, rulesVersion, publishedAt: report.publishedAt, report } },
                        { upsert: true, new: true, runValidators: true, session }).lean();
                    if (!doc) throw new Error('Report not persisted');
                    return doc.report as PublishedResearchReport;
                });
                if (!saved) throw new Error('Report transaction not committed');
                return saved;
            } finally { await session.endSession(); }
        },
        async claim(userId, token, now) {
            await connectToDatabase();
            // Finish automatic collection/index setup before the first lease or transaction.
            await Promise.all([ResearchReportModel.init(), ResearchReportRequestModel.init()]);
            const values = { token, availableAt: new Date(now.getTime() + 60000), lockedUntil: new Date(now.getTime() + 120000), expiresAt: new Date(now.getTime() + 86400000) };
            const updated = await ResearchReportRequestModel.findOneAndUpdate({ userId, availableAt: { $lte: now }, lockedUntil: { $lte: now } }, { $set: values }, { new: true });
            if (updated) return true;
            try { await ResearchReportRequestModel.create({ userId, ...values }); return true; }
            catch (error) { if ((error as { code?: number }).code === 11000) return false; throw error; }
        },
        async release(userId, token) {
            await connectToDatabase();
            await ResearchReportRequestModel.updateOne({ userId, token }, { $set: { lockedUntil: new Date(0) } });
        },
    };
}
