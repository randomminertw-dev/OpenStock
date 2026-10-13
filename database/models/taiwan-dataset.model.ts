import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface ITaiwanDataset extends Document {
    id: string;
    key: string;
    period: string;
    asof: string | null;
    payload: unknown;
    createdAt: Date;
    updatedAt: Date;
}

const TaiwanDatasetSchema = new Schema<ITaiwanDataset>(
    {
        id: { type: String, required: true, trim: true },
        key: { type: String, required: true, default: '', trim: true },
        period: { type: String, required: true, default: '', trim: true },
        asof: { type: String, default: null },
        payload: { type: Schema.Types.Mixed, default: null },
    },
    { timestamps: true }
);

TaiwanDatasetSchema.index({ id: 1, key: 1, period: 1 }, { unique: true });

export const TaiwanDatasetModel: Model<ITaiwanDataset> =
    (models?.TaiwanDataset as Model<ITaiwanDataset>) ||
    model<ITaiwanDataset>('TaiwanDataset', TaiwanDatasetSchema);
