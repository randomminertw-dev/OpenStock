import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface ITaiwanRateLimit extends Document {
    _id: string;
    nextAllowedAt: number;
    lastReservedAt: number;
    updatedAt: Date;
}

const TaiwanRateLimitSchema = new Schema<ITaiwanRateLimit>(
    {
        _id: { type: String, required: true },
        nextAllowedAt: { type: Number, required: true, default: 0 },
        lastReservedAt: { type: Number, required: true, default: 0 },
    },
    { timestamps: true, bufferCommands: false }
);

export const TaiwanRateLimitModel: Model<ITaiwanRateLimit> =
    (models?.TaiwanRateLimit as Model<ITaiwanRateLimit>) ||
    model<ITaiwanRateLimit>('TaiwanRateLimit', TaiwanRateLimitSchema);
