'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/better-auth/auth';
import { parseTaiwanKey, taiwanAliases } from '@/lib/taiwan/symbols';
import { getTaiwanSecurity } from '@/lib/taiwan/reads';

async function resolveSymbolAndAliases(
    symbol: string
): Promise<{ canonical: string; aliases: string[] }> {
    if (!symbol || typeof symbol !== 'string') {
        return { canonical: '', aliases: [] };
    }
    const trimmed = symbol.trim();
    const upper = trimmed.toUpperCase();
    const key = parseTaiwanKey(trimmed);
    if (key) {
        const canonical = `${key.exchange}:${key.code}`;
        const aliases = taiwanAliases(key);
        return { canonical, aliases };
    }

    try {
        const sec = await getTaiwanSecurity(trimmed);
        if (sec) {
            const canonical = `${sec.exchange}:${sec.code}`;
            const aliases = taiwanAliases(sec);
            return { canonical, aliases };
        }
    } catch {
        // Fall back to upper
    }

    return { canonical: upper, aliases: [upper] };
}

// -- CRUD Operations --

export async function addToWatchlist(symbol: string, company: string) {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const { canonical, aliases } = await resolveSymbolAndAliases(symbol);

        // Check if an existing alias is already in the watchlist for this user
        const existing = await Watchlist.findOne({
            userId,
            symbol: { $in: aliases.map((a) => a.toUpperCase()) },
        });

        if (existing) {
            return JSON.parse(JSON.stringify(existing));
        }

        // Upsert standard symbol to avoid concurrent duplicates
        const newItem = await Watchlist.findOneAndUpdate(
            { userId, symbol: canonical },
            {
                userId,
                symbol: canonical,
                company,
                addedAt: new Date(),
            },
            { upsert: true, new: true }
        );

        revalidatePath('/', 'layout'); // sidebar lists the watchlist on every page
        return JSON.parse(JSON.stringify(newItem));
    } catch (error) {
        console.error('Error adding to watchlist:', error);
        throw new Error('Failed to add to watchlist');
    }
}

export async function removeFromWatchlist(symbol: string) {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const { aliases } = await resolveSymbolAndAliases(symbol);

        // Delete all equivalent aliases for this user only
        await Watchlist.deleteMany({
            userId,
            symbol: { $in: aliases.map((a) => a.toUpperCase()) },
        });

        revalidatePath('/', 'layout'); // sidebar lists the watchlist on every page
        return { success: true };
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        throw new Error('Failed to remove from watchlist');
    }
}

export async function getUserWatchlist() {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const watchlist = await Watchlist.find({ userId }).sort({ addedAt: -1 });
        return JSON.parse(JSON.stringify(watchlist));
    } catch (error) {
        console.error('Error fetching watchlist:', error);
        return [];
    }
}

// Check if a symbol (or any of its equivalent aliases) is in the user's watchlist
export async function isStockInWatchlist(symbol: string) {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const { aliases } = await resolveSymbolAndAliases(symbol);
        const item = await Watchlist.findOne({
            userId,
            symbol: { $in: aliases.map((a) => a.toUpperCase()) },
        });
        return !!item;
    } catch (error) {
        console.error('Error checking watchlist status:', error);
        return false;
    }
}
