import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { TaiwanBar } from '@/lib/taiwan/types';

export interface ITaiwanBar extends Document, TaiwanBar {
    createdAt: Date;
    updatedAt: Date;
}

const TaiwanBarSchema = new Schema<ITaiwanBar>(
    {
        exchange: { type: String, required: true, enum: ['TWSE', 'TPEX'] },
        code: { type: String, required: true, trim: true },
        tradingDate: { type: String, required: true, trim: true },
        t: { type: Number, required: true },
        o: { type: Number, required: true },
        h: { type: Number, required: true },
        l: { type: Number, required: true },
        c: { type: Number, required: true },
        v: { type: Number, required: true },
        change: { type: Number, default: null },
        complete: { type: Boolean, required: true, default: false },
        source: { type: String, required: true, enum: ['twse', 'tpex'] },
        priceBasis: { type: String, required: true, default: 'unadjusted' },
        fetchedAt: { type: String, required: true },
    },
    { timestamps: true }
);

TaiwanBarSchema.index(
    { exchange: 1, code: 1, tradingDate: 1, priceBasis: 1 },
    { unique: true }
);

export const TaiwanBarModel: Model<ITaiwanBar> =
    (models?.TaiwanBar as Model<ITaiwanBar>) ||
    model<ITaiwanBar>('TaiwanBar', TaiwanBarSchema);
