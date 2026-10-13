import React from 'react';
import { Calendar, ExternalLink, FileText, Landmark, TrendingUp } from 'lucide-react';
import type { TaiwanDetails as TaiwanDetailsData } from '@/lib/taiwan/types';

export function stripHtml(input: string | undefined): string {
    if (!input) return '';
    return input.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

export function sanitizeAnnouncementUrl(rawUrl: string | undefined): string | null {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (trimmed.toLowerCase().startsWith('javascript:')) return null;
    if (trimmed.startsWith('https://')) return trimmed;
    if (trimmed.startsWith('http://')) return trimmed.replace(/^http:\/\//, 'https://');
    return null;
}

export default function TaiwanDetails({
    details,
}: {
    details: TaiwanDetailsData | null;
}) {
    if (!details) {
        return (
            <div className="card p-5">
                <h3 className="font-semibold text-base mb-2">基本面與公告</h3>
                <p className="text-sm text-faint">暫無詳細基本面資料</p>
            </div>
        );
    }

    const { security, fields = [], announcements = [], events = [] } = details;
    const isEtf = security.kind === 'etf';

    // Filter fields: ETFs MUST NOT have PE or EPS
    const filteredFields = isEtf
        ? fields.filter(
              (f) =>
                  !f.label.includes('本益比') &&
                  !f.label.includes('每股盈餘') &&
                  !f.label.toUpperCase().includes('PE') &&
                  !f.label.toUpperCase().includes('EPS')
          )
        : fields;

    // ETF specific summary items
    const etfInfo = isEtf
        ? [
              { label: '追蹤指數', value: security.metadata.indexName || findFieldValue(fields, '追蹤指數') },
              { label: '發行人', value: security.metadata.issuer || findFieldValue(fields, '發行人') },
              { label: '基金類型', value: security.metadata.fundType || findFieldValue(fields, '基金類型') },
              { label: '上市日期', value: security.listingDate || findFieldValue(fields, '上市日期') },
              { label: '保管機構', value: security.metadata.custodian || findFieldValue(fields, '保管機構') },
          ].filter((item) => Boolean(item.value))
        : [];

    return (
        <div className="flex flex-col gap-3">
            {/* Fundamentals / ETF Info Card */}
            <div className="card p-5">
                <div className="flex items-center gap-2 mb-4">
                    <span className="bento-ico">
                        {isEtf ? <Landmark className="size-4" /> : <TrendingUp className="size-4" />}
                    </span>
                    <h3 className="font-semibold text-base">
                        {isEtf ? 'ETF 基金基本資料' : '公司評價與財務指標'}
                    </h3>
                </div>

                {isEtf ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {etfInfo.map(({ label, value }) => (
                            <div key={label} className="bento-tile gap-1 p-3">
                                <span className="text-xs text-faint">{label}</span>
                                <span className="text-sm font-semibold text-foreground truncate">
                                    {value}
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {filteredFields.length > 0 ? (
                            filteredFields.map(({ label, value, period, unit }, idx) => {
                                const displayVal =
                                    value !== null && value !== undefined && value !== ''
                                        ? `${value}${unit ? ` ${unit}` : ''}`
                                        : '—';
                                return (
                                    <div key={label + idx} className="bento-tile gap-1 p-3">
                                        <div className="flex items-center justify-between text-xs text-faint">
                                            <span>{label}</span>
                                            {period && <span className="mono">{period}</span>}
                                        </div>
                                        <span className="text-sm font-semibold text-foreground truncate">
                                            {displayVal}
                                        </span>
                                    </div>
                                );
                            })
                        ) : (
                            <p className="text-sm text-faint col-span-full">暫無評價與財務欄位</p>
                        )}
                    </div>
                )}
            </div>

            {/* Corporate Actions / Events Card */}
            {events.length > 0 && (
                <div className="card p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="bento-ico">
                            <Calendar className="size-4 text-warn" />
                        </span>
                        <h3 className="font-semibold text-base">除權息與公司事件</h3>
                    </div>
                    <div className="flex flex-col divide-y divide-line">
                        {events.map((evt, idx) => (
                            <div key={evt.date + idx} className="py-2.5 flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="mono text-xs font-semibold text-brand">
                                            {evt.date}
                                        </span>
                                        <span className="pill text-[11px] py-0 px-1.5">
                                            {evt.kind === 'dividend'
                                                ? '除權息'
                                                : evt.kind === 'split'
                                                  ? '股票分割'
                                                  : '公司變動'}
                                        </span>
                                    </div>
                                    <p className="text-sm text-foreground mt-0.5">{evt.title}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="text-[12px] text-faint mt-3">
                        ※ 價格為未調整口徑；除權息與分割歷史不回溯修改過去 K 線
                    </p>
                </div>
            )}

            {/* Material Announcements Card */}
            {announcements.length > 0 && (
                <div className="card p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="bento-ico">
                            <FileText className="size-4" />
                        </span>
                        <h3 className="font-semibold text-base">重大訊息與公告</h3>
                    </div>
                    <div className="flex flex-col divide-y divide-line">
                        {announcements.map((ann, idx) => {
                            const cleanTitle = stripHtml(ann.title);
                            const cleanBody = stripHtml(ann.body);
                            const safeUrl = sanitizeAnnouncementUrl(ann.sourceUrl);

                            return (
                                <div key={ann.date + idx} className="py-3 flex flex-col gap-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="mono text-xs text-faint">{ann.date}</span>
                                        {safeUrl ? (
                                            <a
                                                href={safeUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-brand hover:underline inline-flex items-center gap-1"
                                            >
                                                來源公告 <ExternalLink className="size-3" />
                                            </a>
                                        ) : (
                                            <span className="text-xs text-faint">公開資訊觀測站</span>
                                        )}
                                    </div>
                                    <h4 className="text-sm font-semibold text-foreground">
                                        {cleanTitle}
                                    </h4>
                                    {cleanBody && (
                                        <p className="text-xs text-faint line-clamp-3">
                                            {cleanBody}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

function findFieldValue(
    fields: { label: string; value: string | null }[],
    label: string
): string | null {
    const found = fields.find((f) => f.label === label);
    return found?.value ?? null;
}
