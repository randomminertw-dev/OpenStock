"use client";

import { useId } from "react";

/**
 * RandomInvestigation brand identity — inline SVG, no binary assets.
 * Amber-gold "RI" monogram on deep space navy, echoing the investigation theme.
 */

export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
    const gradId = `ri-grad-${uid}`;
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            role="img"
            aria-label="RandomInvestigation"
            className={className}
        >
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#F4C452" />
                    <stop offset="0.55" stopColor="#E3A82F" />
                    <stop offset="1" stopColor="#C07F16" />
                </linearGradient>
            </defs>
            <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill={`url(#${gradId})`} />
            <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill="black" fillOpacity="0.08" />
            {/* magnifier hint: ring around the monogram field */}
            <circle cx="16" cy="14.5" r="7.2" stroke="#1B2340" strokeOpacity="0.28" strokeWidth="1.6" />
            <text
                x="16"
                y="19.6"
                textAnchor="middle"
                fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
                fontWeight="800"
                fontSize="12.5"
                letterSpacing="0.5"
                fill="#1B2340"
            >
                RI
            </text>
            {/* handle of the magnifier */}
            <line x1="21.2" y1="19.8" x2="25.4" y2="24" stroke="#1B2340" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
    );
}

export function BrandLogo({
    markSize = 30,
    className = "",
    wordmarkClassName = "",
}: {
    markSize?: number;
    className?: string;
    wordmarkClassName?: string;
}) {
    return (
        <span className={`inline-flex items-center gap-2.5 ${className}`}>
            <BrandMark size={markSize} className="shrink-0" />
            <span
                className={`truncate text-[17px] font-extrabold tracking-[-0.02em] ${wordmarkClassName}`}
            >
                <span className="text-foreground">Random</span>
                <span className="text-brand-ink">Investigation</span>
            </span>
        </span>
    );
}
