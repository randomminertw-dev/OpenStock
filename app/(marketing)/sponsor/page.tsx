import Link from "next/link";
import { HandCoins } from "lucide-react";

export const metadata = {
    title: 'Sponsor RandomInvestigation',
    description: 'Sponsorship options for RandomInvestigation are coming soon.',
};

export default function SponsorPage() {
    return (
        <div className="mx-auto flex max-w-[720px] flex-col items-center gap-6 px-5 py-24 text-center">
            <span className="logo-well is-empty size-14">
                <HandCoins className="size-6" />
            </span>
            <h1 className="text-3xl font-bold tracking-[-0.02em]">贊助功能即將推出</h1>
            <p className="max-w-[480px] text-[15px] leading-relaxed text-muted-foreground">
                RandomInvestigation 目前由維護者個人營運，贊助方案正在規劃中。
                如果你想支持這個專案，歡迎先到 GitHub 給我們一顆星，或透過 Issues 與我們聯繫。
            </p>
            <div className="flex gap-3">
                <Link href="/about" className="btn btn-ghost h-10 px-5">關於我們</Link>
                <Link href="/" className="btn btn-primary h-10 px-5">回到首頁</Link>
            </div>
        </div>
    );
}
