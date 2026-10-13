import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { FactorPreference } from '@/lib/indicators/factor-periods';

export interface FactorPreferenceDocument extends Document, FactorPreference {
    userId: string;
}

const FactorPreferenceSchema = new Schema<FactorPreferenceDocument>(
    {
        userId: { type: String, required: true },
        market: { type: String, required: true, enum: ['us', 'taiwan', 'crypto'] },
        preset: { type: String, required: true, enum: ['legacy', 'short', 'medium', 'long', 'custom'] },
        periods: {
            T: { type: Number, required: true },
            M: { type: Number, required: true },
            V: { type: Number, required: true },
            R: { type: Number, required: true },
        },
        interval: { type: String, enum: ['4h', '8h', '12h', '1d', null], default: null },
    },
    { timestamps: true }
);

FactorPreferenceSchema.index({ userId: 1, market: 1 }, { unique: true });

export const FactorPreferenceModel: Model<FactorPreferenceDocument> =
    (models?.FactorPreference as Model<FactorPreferenceDocument>) ||
    model<FactorPreferenceDocument>('FactorPreference', FactorPreferenceSchema);
