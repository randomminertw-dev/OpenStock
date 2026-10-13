import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface ITaiwanUsage extends Document {
    day: string;
    requests: number;
    jobs: number;
    transferBytes: number;
    storageBytes: number;
    createdAt: Date;
    updatedAt: Date;
}

const TaiwanUsageSchema = new Schema<ITaiwanUsage>(
    {
        day: { type: String, required: true, trim: true },
        requests: { type: Number, required: true, default: 0 },
        jobs: { type: Number, required: true, default: 0 },
        transferBytes: { type: Number, required: true, default: 0 },
        storageBytes: { type: Number, required: true, default: 0 },
    },
    { timestamps: true }
);

TaiwanUsageSchema.index({ day: 1 }, { unique: true });

export const TaiwanUsageModel: Model<ITaiwanUsage> =
    (models?.TaiwanUsage as Model<ITaiwanUsage>) ||
    model<ITaiwanUsage>('TaiwanUsage', TaiwanUsageSchema);
