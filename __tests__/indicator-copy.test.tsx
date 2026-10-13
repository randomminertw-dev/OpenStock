import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import IndicatorTable, { formatIndicatorCopyText } from '@/components/stocks/IndicatorTable';
import type { IndicatorResult } from '@/lib/indicators/types';

const result = (id: string, value: number | null, signal: IndicatorResult['signal']): IndicatorResult => ({
    id, name: `指標${id}`, category: 'volatility', value, signal, reason: '',
});

describe('57-indicator copy', () => {
    it('copies every item in display order with visible precision and N/A', () => {
        const results = [
            result('1', 1234.56, 1),
            result('2', 0.123456, 0),
            result('3', null, null),
            result('4', 9.5, null),
            ...Array.from({ length: 53 }, (_, i) => result(String(i + 5), 0, 0)),
        ];
        const lines = formatIndicatorCopyText(results).split('\n');
        expect(lines).toHaveLength(57);
        expect(lines.slice(0, 4)).toEqual([
            '波動｜指標1：1,235',
            '波動｜指標2：0.1235',
            '波動｜指標3：N/A',
            '波動｜指標4：N/A',
        ]);
        expect(lines[56]).toBe('波動｜指標57：0.0000');
    });

    it('renders a separate copy control without expanding the list', () => {
        const html = renderToStaticMarkup(<IndicatorTable results={[result('1', 12.5, 1)]} />);
        expect(html).toContain('aria-label="複製 57 項指標數值"');
        expect(html).toContain('aria-expanded="false"');
        expect(html.match(/<button\b/g)).toHaveLength(2);
        expect(html).not.toContain('指標1');
    });
});
