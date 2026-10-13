import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { TaiwanSecurity } from '../../lib/taiwan/types';

export interface ITaiwanSecurity extends Document, Omit<TaiwanSecurity, 'metadata'> {
    metadata: Record<string, string>;
    createdAt: Date;
    updatedAt: Date;
}

const TaiwanSecuritySchema = new Schema<ITaiwanSecurity>(
    {
        exchange: { type: String, required: true, enum: ['TWSE', 'TPEX'] },
        code: { type: String, required: true, trim: true },
        symbol: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        kind: { type: String, required: true, enum: ['stock', 'etf', 'unknown'] },
        currency: { type: String, default: null },
        listingDate: { type: String, default: null },
        status: { type: String, required: true, enum: ['active', 'suspended', 'delisted', 'unknown'] },
        metadata: { type: Schema.Types.Mixed, default: {} },
        source: { type: String, required: true },
        asof: { type: String, required: true },
    },
    { timestamps: true }
);

TaiwanSecuritySchema.index({ exchange: 1, code: 1 }, { unique: true });

export const TaiwanSecurityModel: Model<ITaiwanSecurity> =
    (models?.TaiwanSecurity as Model<ITaiwanSecurity>) ||
    model<ITaiwanSecurity>('TaiwanSecurity', TaiwanSecuritySchema);
