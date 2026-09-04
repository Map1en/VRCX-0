// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTimeUnitLabels, setI18nLanguage } from '@/services/i18nService';
import {
    DEFAULT_TIME_UNIT_LABELS,
    type TimeUnitLabels
} from '@/shared/utils/dateTime';

const timerState = vi.hoisted((): { timeUnitLabels: TimeUnitLabels } => ({
    timeUnitLabels: { y: 'y', d: 'd', h: 'h', m: 'm', s: 's' }
}));

vi.mock('@/state/shellStore', () => ({
    useShellStore: <T,>(selector: (state: typeof timerState) => T): T =>
        selector(timerState)
}));

import { FriendInstanceTimer } from '@/components/friends/FriendInstanceTimer';

const NOW_MS = 1_700_000_000_000;

describe('FriendInstanceTimer', () => {
    beforeEach(async () => {
        await setI18nLanguage('en');
        timerState.timeUnitLabels = { ...DEFAULT_TIME_UNIT_LABELS };
        vi.useFakeTimers();
        vi.setSystemTime(NOW_MS);
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it.each(['default', 'short'] as const)(
        'counts up in 30-second buckets, then in whole minutes with %s format',
        async (format) => {
            const { container } = render(
                <FriendInstanceTimer epoch={NOW_MS} format={format} />
            );
            const displayedText = () =>
                container.querySelector('.tabular-nums')?.textContent;

            expect(displayedText()).toBe('0s');
            await act(() => vi.advanceTimersByTimeAsync(29_999));
            expect(displayedText()).toBe('0s');
            await act(() => vi.advanceTimersByTimeAsync(1));
            expect(displayedText()).toBe('30s');
            await act(() => vi.advanceTimersByTimeAsync(29_999));
            expect(displayedText()).toBe('30s');
            await act(() => vi.advanceTimersByTimeAsync(1));
            expect(displayedText()).toBe('1m');
            await act(() => vi.advanceTimersByTimeAsync(59_999));
            expect(displayedText()).toBe('1m');
            await act(() => vi.advanceTimersByTimeAsync(1));
            expect(displayedText()).toBe('2m');
            await act(() => vi.advanceTimersByTimeAsync(60_000));
            expect(displayedText()).toBe('3m');
        }
    );

    it.each(['default', 'short'] as const)(
        'continues with whole minutes across the hour boundary with %s format',
        async (format) => {
            const { container } = render(
                <FriendInstanceTimer
                    epoch={NOW_MS - 59 * 60_000 - 59_999}
                    format={format}
                />
            );
            const displayedText = () =>
                container.querySelector('.tabular-nums')?.textContent;

            expect(displayedText()).toBe('59m');
            await act(() => vi.advanceTimersByTimeAsync(1));
            expect(displayedText()).toBe('1h');
            await act(() => vi.advanceTimersByTimeAsync(59_999));
            expect(displayedText()).toBe('1h');
            await act(() => vi.advanceTimersByTimeAsync(1));
            expect(displayedText()).toBe(format === 'short' ? '1h1m' : '1h 1m');
        }
    );

    it.each([
        ['en', '1h37m'],
        ['zh-CN', '1小时37分'],
        ['zh-TW', '1小時37分'],
        ['ja', '1時間37分'],
        ['ko', '1시간37분']
    ])(
        'uses localized short units in %s without changing the default timer',
        async (locale, expected) => {
            await setI18nLanguage(locale);
            timerState.timeUnitLabels = getTimeUnitLabels(
                locale,
                DEFAULT_TIME_UNIT_LABELS
            );
            const epoch = NOW_MS - 97 * 60_000;
            const { container } = render(
                <>
                    <FriendInstanceTimer epoch={epoch} />
                    <FriendInstanceTimer epoch={epoch} format="short" />
                </>
            );
            const timers = container.querySelectorAll('.tabular-nums');
            const fullText = `1${timerState.timeUnitLabels.h} 37${timerState.timeUnitLabels.m}`;
            expect(timers[0]?.textContent).toBe(fullText);
            expect(timers[1]?.textContent).toBe(expected);
            expect(container.querySelector('.sr-only')?.textContent).toBe(
                fullText
            );
        }
    );

    it('shows the full duration on hover without adding a button to the card', async () => {
        await setI18nLanguage('zh-CN');
        timerState.timeUnitLabels = getTimeUnitLabels(
            'zh-CN',
            DEFAULT_TIME_UNIT_LABELS
        );
        const { container } = render(
            <FriendInstanceTimer epoch={NOW_MS - 97 * 60_000} format="short" />
        );
        const trigger = container.querySelector(
            '[data-slot="tooltip-trigger"]'
        );
        expect(trigger).not.toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
        expect(
            document.querySelector('[data-slot="tooltip-content"]')
        ).toBeNull();
        if (trigger) {
            fireEvent.mouseEnter(trigger);
            fireEvent.mouseMove(trigger);
        }
        await act(() => vi.advanceTimersByTimeAsync(700));
        const tooltip = screen.getByText('1小时 37分钟', {
            selector: '[data-slot="tooltip-content"]'
        });
        expect(tooltip.hasAttribute('data-open')).toBe(true);
    });

    it('keeps the unknown timer placeholder without a tooltip', () => {
        const { container } = render(<FriendInstanceTimer format="short" />);
        expect(container.querySelector('.tabular-nums')?.textContent).toBe('-');
        expect(
            container.querySelector('[data-slot="tooltip-trigger"]')
        ).toBeNull();
    });

    it('allows the sidebar to keep sub-minute timers muted', () => {
        render(
            <FriendInstanceTimer
                epoch={NOW_MS}
                className="text-muted-foreground"
            />
        );

        expect(screen.getByText('0s').className).toContain(
            'text-muted-foreground'
        );
        expect(screen.getByText('0s').className).not.toContain(
            'text-foreground'
        );
    });
});
