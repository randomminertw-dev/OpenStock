'use server';

import { connectToDatabase } from '@/database/mongoose';
import { FactorPreferenceModel } from '@/database/models/factor-preference.model';
import { requireUserId } from '@/lib/better-auth/auth';
import {
    defaultFactorPreference, marketForSymbol, parseFactorPreference,
    type FactorPreference,
} from '@/lib/indicators/factor-periods';

export async function getFactorPreference(symbol: string): Promise<{
    preference: FactorPreference; readError: boolean;
} | null> {
    const market = marketForSymbol(symbol);
    if (!market) return null;
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const stored = await FactorPreferenceModel.findOne({ userId, market });
        return {
            preference: stored ? parseFactorPreference(market, stored) : defaultFactorPreference(market),
            readError: false,
        };
    } catch {
        return { preference: defaultFactorPreference(market), readError: true };
    }
}

export async function saveFactorPreference(symbol: string, input: unknown): Promise<FactorPreference> {
    const userId = await requireUserId();
    const market = marketForSymbol(symbol);
    if (!market) throw new Error('Unsupported factor preference market');
    const preference = parseFactorPreference(market, input);
    await connectToDatabase();
    await FactorPreferenceModel.findOneAndUpdate(
        { userId, market },
        { $set: preference },
        { upsert: true, new: true, runValidators: true }
    );
    return preference;
}
