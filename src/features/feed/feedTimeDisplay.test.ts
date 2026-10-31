import { beforeEach, describe, expect, it } from 'vitest';

import { useShellStore } from '@/state/shellStore';

import { formatFeedExactTime, formatFeedRelativeTime } from './feedTimeDisplay';

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
        expect(formatFeedRelativeTime('2026-06-04T07:20:02', BASE_TIME)).toBe(
            new Intl.RelativeTimeFormat('zh-CN', {
                numeric: 'auto',
                style: 'short'
            }).format(-2, 'hour')
        );
    });

    it('collapses relative feed time under one minute to now', () => {
        expect(formatFeedRelativeTime('2026-06-04T09:19:20', BASE_TIME)).toBe(
            new Intl.RelativeTimeFormat('zh-CN', {
                numeric: 'auto',
                style: 'short'
            }).format(0, 'second')
        );
    });

    it('formats exact feed time with the shared app-locale date helper', () => {
        const value = '2026-06-04T07:20:02';

        expect(formatFeedExactTime(value, 'short')).toBe('6月4日 7:20');
    });
});
