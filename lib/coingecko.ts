// lib/coingecko.ts
// Shared helpers for CoinGecko-backed crypto symbols.
// Convention: CoinGecko coins are identified app-wide by the `CG:` prefix,
// e.g. `CG:pha` for Phala Network. Plain module (no 'use server') so both
// server actions and components can import it.

export const CG_PREFIX = 'CG:';

/** Case-insensitive check for the CoinGecko `CG:` symbol prefix. */
export function isCoinGeckoSymbol(symbol: string): boolean {
    return (symbol || '').toUpperCase().startsWith(CG_PREFIX);
}

/** Extract the CoinGecko coin id from a `CG:` symbol, e.g. `CG:PHA` -> `pha`. */
export function coinIdFromSymbol(symbol: string): string {
    return symbol.slice(CG_PREFIX.length).toLowerCase();
}
