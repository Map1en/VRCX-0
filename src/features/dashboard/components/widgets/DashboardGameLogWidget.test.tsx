// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const favoriteState: {
        favoriteFriendIds: string[];
        localFriendFavorites: Record<string, unknown>;
    } = {
        favoriteFriendIds: [],
        localFriendFavorites: {}
    };
    return {
        favoriteState,
        queryGameLog: vi.fn(),
        useThrottledValue: vi.fn(),
        throttledValue: 0,
        runtimeState: {
            auth: { currentUserId: 'usr_self' },
            runtimeEvents: { addGameLogEvent: { count: 0 } }
        }
    };
});

vi.mock('@/lib/useThrottledValue', () => ({
    useThrottledValue: (value: number, intervalMs: number): number => {
        mocks.useThrottledValue(value, intervalMs);
        return mocks.throttledValue;
    }
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    GAME_LOG_FILTER_TYPES: [],
    default: { queryGameLog: mocks.queryGameLog }
}));

vi.mock('@/state/favoriteStore', () => ({
    useFavoriteStore: <T,>(
        selector: (state: typeof mocks.favoriteState) => T
    ) => selector(mocks.favoriteState)
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(selector: (state: typeof mocks.runtimeState) => T) =>
        selector(mocks.runtimeState)
}));

import { DashboardGameLogWidget } from './DashboardGameLogWidget';

describe('DashboardGameLogWidget', () => {
    beforeEach(() => {
        mocks.favoriteState.favoriteFriendIds = [];
        mocks.favoriteState.localFriendFavorites = {};
        mocks.runtimeState.runtimeEvents.addGameLogEvent.count = 0;
        mocks.queryGameLog.mockReset();
        mocks.queryGameLog.mockResolvedValue([]);
        mocks.useThrottledValue.mockReset();
        mocks.throttledValue = 0;
    });

    afterEach(cleanup);

    it('requests the visible row cap after each game-log refresh event', async () => {
        const config = { filters: ['Location'] };
        const renderWidget = () => (
            <MemoryRouter>
                <DashboardGameLogWidget config={config} />
            </MemoryRouter>
        );
        const { rerender } = render(renderWidget());

        await waitFor(() => {
            expect(mocks.queryGameLog).toHaveBeenCalledTimes(1);
            expect(mocks.queryGameLog).toHaveBeenLastCalledWith({
                currentUserId: 'usr_self',
                filters: ['Location'],
                limit: 200
            });
        });

        mocks.runtimeState.runtimeEvents.addGameLogEvent.count = 1;
        mocks.throttledValue = 1;
        rerender(renderWidget());

        await waitFor(() => {
            expect(mocks.queryGameLog).toHaveBeenCalledTimes(2);
            expect(mocks.queryGameLog).toHaveBeenLastCalledWith({
                currentUserId: 'usr_self',
                filters: ['Location'],
                limit: 200
            });
        });
    });

    it('does not re-query while the throttled counter is unchanged', async () => {
        const config = { filters: [] };
        const renderWidget = () => (
            <MemoryRouter>
                <DashboardGameLogWidget config={config} />
            </MemoryRouter>
        );
        const { rerender } = render(renderWidget());

        await waitFor(() => {
            expect(mocks.queryGameLog).toHaveBeenCalledTimes(1);
        });
        expect(mocks.useThrottledValue).toHaveBeenCalledWith(0, 1000);

        for (let count = 1; count <= 5; count += 1) {
            mocks.runtimeState.runtimeEvents.addGameLogEvent.count = count;
            rerender(renderWidget());
        }

        await waitFor(() => {
            expect(mocks.useThrottledValue).toHaveBeenLastCalledWith(5, 1000);
        });
        expect(mocks.queryGameLog).toHaveBeenCalledTimes(1);

        mocks.throttledValue = 5;
        rerender(renderWidget());

        await waitFor(() => {
            expect(mocks.queryGameLog).toHaveBeenCalledTimes(2);
        });
    });

    it('uses session-style day grouping and localized event labels', async () => {
        mocks.favoriteState.favoriteFriendIds = ['usr_one'];
        mocks.queryGameLog.mockResolvedValue([
            {
                type: 'OnPlayerJoined',
                created_at: '2026-08-12T11:37:00.000Z',
                userId: 'usr_one',
                displayName: 'One'
            },
            {
                type: 'OnPlayerLeft',
                created_at: '2026-08-12T10:30:00.000Z',
                userId: 'usr_two',
                displayName: 'Two'
            },
            {
                type: 'OnPlayerJoined',
                created_at: '2026-08-11T09:00:00.000Z',
                userId: 'usr_three',
                displayName: 'Three'
            }
        ]);

        const view = render(
            <MemoryRouter>
                <DashboardGameLogWidget />
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('One')).toBeTruthy());

        expect(
            view.container.querySelectorAll('[data-dashboard-widget-day]')
        ).toHaveLength(2);
        expect(
            screen.getAllByText('view.game_log.filters.OnPlayerJoined')
        ).toHaveLength(2);
        expect(
            view.container.querySelector(
                '[aria-label="common.affinity.favorite"]'
            )
        ).toBeTruthy();
        const eventTypes = Array.from(
            view.container.querySelectorAll(
                '[data-dashboard-widget-event-type]'
            )
        );
        expect(eventTypes).toHaveLength(3);
        expect(
            eventTypes.every((eventType) =>
                eventType.classList.contains('text-right')
            )
        ).toBe(true);
        const affinitySlot = view.container.querySelector(
            '[data-dashboard-widget-affinity-slot]'
        );
        expect(affinitySlot?.nextElementSibling?.textContent).toBe('One');
    });

    it('shows miscellaneous event content instead of repeating its type', async () => {
        mocks.queryGameLog.mockResolvedValue([
            {
                type: 'Event',
                created_at: '2026-08-12T01:02:00.000Z',
                data: 'Audio device changed'
            },
            {
                type: 'External',
                created_at: '2026-08-12T01:01:00.000Z',
                message: 'External message'
            },
            {
                type: 'StringLoad',
                created_at: '2026-08-12T01:00:00.000Z',
                resourceUrl: 'https://example.com/message.txt'
            },
            {
                type: 'ImageLoad',
                created_at: '2026-08-12T00:59:00.000Z',
                resourceUrl: 'https://example.com/image.png'
            }
        ]);

        render(
            <MemoryRouter>
                <DashboardGameLogWidget />
            </MemoryRouter>
        );

        await waitFor(() =>
            expect(screen.getByText('Audio device changed')).toBeTruthy()
        );

        expect(screen.getByText('External message')).toBeTruthy();
        expect(
            screen.getByText('https://example.com/message.txt')
        ).toBeTruthy();
        expect(screen.getByText('https://example.com/image.png')).toBeTruthy();
        expect(screen.queryByText('Event')).toBeNull();
        expect(screen.queryByText('External')).toBeNull();
        expect(screen.queryByText('StringLoad')).toBeNull();
        expect(screen.queryByText('ImageLoad')).toBeNull();
    });
});
