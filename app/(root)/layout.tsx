import { getSession } from "@/lib/better-auth/auth";
import { redirect } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { getUserWatchlist } from "@/lib/actions/watchlist.actions";

// Cold official catalog reads are bounded but may exceed the legacy 10-second limit.
export const maxDuration = 60;

const Layout = async ({ children }: { children: React.ReactNode }) => {
    const session = await getSession();

    if (!session?.user) redirect('/sign-in');

    const user = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
    }

    const [initialStocks, watchlist] = await Promise.all([
        searchStocks(),
        getUserWatchlist(),
    ]);

    return (
        <>
            <AppShell
                user={user}
                watchlist={watchlist.map(({ symbol, company }: { symbol: string; company: string }) => ({ symbol, company }))}
                initialStocks={initialStocks}
            >
                {children}
            </AppShell>
        </>
    )
}
export default Layout
