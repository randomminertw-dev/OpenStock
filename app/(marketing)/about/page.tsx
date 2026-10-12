import Image from 'next/image';
import { Code, Globe, Heart } from 'lucide-react';
import PageHero from '@/components/marketing/PageHero';
import SectionHead from '@/components/marketing/SectionHead';
import IconCard from '@/components/marketing/IconCard';
import { GOOD_FIRST_ISSUES_URL, REPO_URL } from '@/lib/constants';

export const metadata = {
    title: 'About | RandomInvestigation',
    description: 'RandomInvestigation is a community fork of OpenStock, maintained independently.',
};

const PRINCIPLES = [
    { icon: Globe, title: 'Open access', body: 'No paywall on the core. Charts, watchlists and research stay free for everyone, and self-hosting unlocks everything.' },
    { icon: Code, title: 'Open source', body: 'Fully transparent codebase under AGPL-3.0. Audit the code, contribute features, and build with us.' },
    { icon: Heart, title: 'Community driven', body: 'Maintained in the open. We answer to our users, not shareholders.' },
];

export default function AboutPage() {
    return (
        <>
            <PageHero
                kicker="About"
                title="Tools for everyone."
                sub="We believe financial intelligence shouldn’t be locked behind paywalls. RandomInvestigation is built by the community, for the community."
            >
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn btn-primary h-11 px-5 text-[15px]">See the code</a>
                <a href={GOOD_FIRST_ISSUES_URL} target="_blank" rel="noreferrer" className="btn btn-ghost h-11 px-5 text-[15px]">Contribute</a>
            </PageHero>

            <section className="mx-auto mt-20 max-w-[1200px] px-5">
                <SectionHead kicker="Principles" title="What we won’t compromise on." />
                <div className="grid gap-3 md:grid-cols-3">
                    {PRINCIPLES.map(({ icon, title, body }) => <IconCard key={title} icon={icon} title={title}>{body}</IconCard>)}
                </div>
            </section>

            <section className="mx-auto mt-24 max-w-[1200px] px-5">
                <div className="hatch">
                    <div className="card grid items-center gap-10 p-8 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:p-12">
                        <div className="flex flex-col gap-4">
                            <p className="kicker text-brand-ink">出處與授權</p>
                            <h2 className="text-[30px] font-bold leading-tight tracking-[-0.04em]">一個獨立維護的分支。</h2>
                            <p className="text-[16px] leading-relaxed text-muted-foreground">
                                RandomInvestigation 是 OpenStock（© Open Dev Society）的修改版（fork），由 randomminertw-dev
                                獨立維護。我們在原專案的基礎上加入了加密貨幣支援（CoinGecko）、繁體中文介面與全新的視覺設計。
                            </p>
                            <p className="text-[16px] leading-relaxed text-muted-foreground">
                                本站遵循 AGPL-3.0 授權，與原專案相同。原始碼公開透明，歡迎檢視、回報問題或貢獻程式碼。
                                原專案由 Open Dev Society 開發並維護，感謝他們的開源貢獻。
                            </p>
                            <a href="https://github.com/Open-Dev-Society/OpenStock" target="_blank" rel="noreferrer" className="btn btn-ghost mt-2 self-start">
                                原始專案：OpenStock
                            </a>
                        </div>
                        <div className="relative grid aspect-square max-h-[340px] place-items-center rounded-[16px] bg-page shadow-[inset_0_0_0_1px_var(--line)]">
                            <Image src="/assets/icons/odsLogo.svg" alt="Open Dev Society" fill className="object-contain p-16 opacity-90" />
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
}
