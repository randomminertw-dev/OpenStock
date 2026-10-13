"use client"

import { useEffect, useRef, useState } from "react"
import { CommandDialog, CommandEmpty, CommandInput, CommandList } from "@/components/ui/command"
import { ArrowUpRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { useDebounce } from "@/hooks/useDebounce";

const OPEN_SEARCH_EVENT = 'open-search';

// Any button can open the one palette mounted in the app shell.
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));

export const SearchButton = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <button type="button" onClick={openSearch} className={className}>{children}</button>
);

/**
 * Creates a sequence guard to ensure slow earlier searches do not overwrite newer results.
 */
export function createSearchSequenceGuard() {
    let currentSeq = 0;
    return {
        next: () => ++currentSeq,
        isLatest: (seq: number) => seq === currentSeq,
        current: () => currentSeq,
    };
}

/**
 * Detects whether an event is in IME composition (e.g. typing Zhuyin/Pinyin candidate).
 */
export function isImeComposing(event: {
    isComposing?: boolean;
    nativeEvent?: { isComposing?: boolean };
    keyCode?: number;
}): boolean {
    if (event.isComposing) return true;
    if (event.nativeEvent?.isComposing) return true;
    if (event.keyCode === 229) return true;
    return false;
}

/**
 * Resolves the message to display in .search-list-indicator based on error state and search term.
 * If search failed due to database unreadiness or uninitialized index, displays the error message
 * without claiming "Nothing matches".
 */
export function getSearchIndicatorText({
    errorMessage,
    isSearchMode,
    searchTerm,
}: {
    errorMessage?: string | null;
    isSearchMode: boolean;
    searchTerm: string;
}): string {
    if (errorMessage) {
        return errorMessage;
    }
    if (isSearchMode) {
        return `Nothing matches “${searchTerm.trim()}”`;
    }
    return 'No stocks available';
}

export default function SearchCommand({
    initialStocks,
    defaultOpen = false,
    initialMounted = false,
    initialErrorMessage = null,
    initialSearchTerm = '',
}: {
    initialStocks: StockWithWatchlistStatus[];
    defaultOpen?: boolean;
    initialMounted?: boolean;
    initialErrorMessage?: string | null;
    initialSearchTerm?: string;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
    const [loading, setLoading] = useState(false);
    const [stocks, setStocks] = useState<StockWithWatchlistStatus[]>(initialStocks);
    const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
    const searchSeqRef = useRef(0);
    const isComposingRef = useRef(false);

    // The palette starts closed, so render it only after hydration (avoids Radix id mismatches)
    const [mounted, setMounted] = useState(initialMounted);
    useEffect(() => setMounted(true), []);

    const isSearchMode = !!searchTerm.trim();
    const displayStocks = isSearchMode ? stocks : stocks?.slice(0, 10);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault()
                setOpen(v => !v)
            }
        }
        const onOpen = () => setOpen(true)
        window.addEventListener("keydown", onKeyDown)
        window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
        return () => {
            window.removeEventListener("keydown", onKeyDown)
            window.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
        }
    }, [])

    const handleSearch = async () => {
        if (!isSearchMode) {
            searchSeqRef.current++;
            setErrorMessage(null);
            return setStocks(initialStocks);
        }

        const seq = ++searchSeqRef.current;
        setLoading(true);
        try {
            const results = await searchStocks(searchTerm.trim());
            if (seq === searchSeqRef.current) {
                setErrorMessage(null);
                setStocks(results);
            }
        } catch (err: unknown) {
            if (seq === searchSeqRef.current) {
                const message =
                    err instanceof Error && err.message
                        ? err.message
                        : '台股資料庫準備中或同步未啟用';
                setErrorMessage(message);
                setStocks([]);
            }
        } finally {
            if (seq === searchSeqRef.current) {
                setLoading(false);
            }
        }
    };

    const debouncedSearch = useDebounce(handleSearch, 300);

    useEffect(() => {
        debouncedSearch();
    }, [debouncedSearch, searchTerm]);

    const handleSelectStock = () => {
        setOpen(false);
        setSearchTerm("");
        setErrorMessage(null);
        setStocks(initialStocks);
    }

    if (!mounted) return null;

    return (
        <CommandDialog open={open} onOpenChange={setOpen} className="search-dialog">
            <div className="search-field">
                <CommandInput
                    value={searchTerm}
                    onValueChange={setSearchTerm}
                    onCompositionStart={() => {
                        isComposingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                        isComposingRef.current = false;
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (isComposingRef.current || isImeComposing(e))) {
                            // IME confirmation enter should not trigger navigation
                            e.stopPropagation();
                        }
                    }}
                    placeholder="Search by company or symbol"
                    className="search-input"
                />
                {loading && <Loader2 className="search-loader" />}
            </div>
            <CommandList className="search-list">
                {loading ? (
                    <CommandEmpty className="search-list-empty">Searching</CommandEmpty>
                ) : displayStocks?.length === 0 ? (
                    <div className="search-list-indicator">
                        {getSearchIndicatorText({ errorMessage, isSearchMode, searchTerm })}
                    </div>
                ) : (
                    <ul>
                        <li className="search-count">
                            {isSearchMode ? 'Results' : 'Popular'}
                            <span className="num"> · {displayStocks?.length || 0}</span>
                        </li>
                        {displayStocks?.map((stock) => (
                            <li key={stock.symbol} className="search-item">
                                <Link
                                    href={`/stocks/${stock.symbol}`}
                                    onClick={handleSelectStock}
                                    className="search-item-link group"
                                >
                                    <span className="mono w-20 shrink-0 text-[13px] font-semibold text-brand-ink truncate">{stock.symbol}</span>
                                    <span className="search-item-name flex-1">{stock.name}</span>
                                    <span className="hidden sm:block text-xs text-faint truncate max-w-40">{[stock.exchange, stock.type].filter(Boolean).join(' · ')}</span>
                                    <ArrowUpRight className="size-4 text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </CommandList>
        </CommandDialog>
    )
}
