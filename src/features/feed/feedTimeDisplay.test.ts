import { beforeEach, describe, expect, it } from 'vitest';

import { useShellStore } from '@/state/shellStore';

import {
    formatFeedExactTime,
    formatFeedRelativeTime,
    resolveFeedColumnTimeDisplay
} from './feedTimeDisplay';

const BASE_TIME = new Date('2026-06-04T09:20:02').getTime();

describe('feedTimeDisplay', () => {
    beforeEach(() => {
        useShellStore.setState({
            locale: 'zh-CN',
            dateCulture: 'en-gb',
            dateIsoFormat: false,
            dateHour12: false
        });
    });

    it('formats relative feed time with the app locale', () => {
        expect(
            formatFeedRelativeTime(
                '2026-06-04T07:20:02',
                BASE_TIME,
                (() => '') as any
            )
        ).toBe(
            new Intl.RelativeTimeFormat('zh-CN', {
                numeric: 'auto',
                style: 'short'
            }).format(-2, 'hour')
        );
    });

    it('formats exact feed time with the shared app-locale date helper', () => {
        const value = '2026-06-04T07:20:02';

        expect(formatFeedExactTime(value, 'short')).toBe('6月4日 7:20');
    });

    it('uses localized short time for exact feed column labels', () => {
        const value = '2026-06-04T07:20:02';

        expect(
            resolveFeedColumnTimeDisplay({
                mode: 'exact',
                nowMs: BASE_TIME,
                t: (() => '') as any,
                value
            }).label
        ).toBe('6月4日 7:20');
    });
});
