import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { TaiwanHistoryStatus } from '../../lib/taiwan/types';

export interface ITaiwanSync extends Document {
    jobKey: string;
    owner: string | null;
    lockedUntil: Date | null;
    historyStatus: TaiwanHistoryStatus | null;
    createdAt: Date;
    updatedAt: Date;
}

const TaiwanSyncSchema = new Schema<ITaiwanSync>(
    {
        jobKey: { type: String, required: true, trim: true },
        owner: { type: String, default: null },
        lockedUntil: { type: Date, default: null },
        historyStatus: {
            state: {
                type: String,
                enum: ['disabled', 'queued', 'running', 'partial', 'ready', 'error'],
                default: 'disabled',
            },
            completed: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
            candleCount: { type: Number, default: 0 },
            reason: {
                type: String,
                enum: ['api-error', 'budget-limit', 'missing-config', null],
                default: null,
            },
        },
    },
    { timestamps: true }
);

TaiwanSyncSchema.index({ jobKey: 1 }, { unique: true });

export const TaiwanSyncModel: Model<ITaiwanSync> =
    (models?.TaiwanSync as Model<ITaiwanSync>) ||
    model<ITaiwanSync>('TaiwanSync', TaiwanSyncSchema);
