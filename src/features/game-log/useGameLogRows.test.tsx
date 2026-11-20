// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    favorites: { favoriteFriendIds: [], localFriendFavorites: [] },
    liveEventCount: 0,
    queryGameLog: vi.fn(),
    queryLatestSessions: vi.fn()
}));

vi.mock('@/lib/useThrottledValue', () => ({
    useThrottledValue: (value: number) => value
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        queryGameLog: mocks.queryGameLog,
        queryLatestSessions: mocks.queryLatestSessions
    }
}));

vi.mock('@/state/favoriteStore', () => ({
    useFavoriteStore: (
        selector: (state: {
            favoriteFriendIds: string[];
            localFriendFavorites: string[];
        }) => unknown
    ) => selector(mocks.favorites)
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: (
        selector: (state: { gameLogDisabled: boolean }) => unknown
    ) => selector({ gameLogDisabled: false })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: {
            auth: { currentUserId: string };
            runtimeEvents: { addGameLogEvent: { count: number } };
        }) => unknown
    ) =>
        selector({
            auth: { currentUserId: 'usr_self' },
            runtimeEvents: {
                addGameLogEvent: { count: mocks.liveEventCount }
            }
        })
}));

vi.mock('@/state/sessionStore', () => ({
    useSessionStore: (
        selector: (state: { isFavoritesLoaded: boolean }) => unknown
    ) => selector({ isFavoritesLoaded: true })
}));

import type { GameLogSession } from './gameLogTypes';
import { useGameLogRows } from './useGameLogRows';

function session(id: number): GameLogSession {
    return {
        id,
        created_at: `2026-09-03T00:${String(id).padStart(2, '0')}:00.000Z`,
        duration: 0,
        location: `wrld_test:${id}`,
        worldId: 'wrld_test',
        worldName: `World ${id}`,
        groupName: '',
        remote: false,
        playerDurationRows: [],
        events: []
    };
}

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

const sessionOptions = {
    deferredSearchQuery: '',
    favoritesOnly: false,
    filters: [],
    preferencesReady: true,
    refreshToken: 0,
    sessionDateFrom: '',
    sessionDateTo: '',
    sessionLimit: 20,
    viewMode: 'sessions' as const
};

describe('useGameLogRows', () => {
    afterEach(cleanup);

    beforeEach(() => {
        mocks.liveEventCount = 0;
        mocks.queryGameLog.mockReset();
        mocks.queryGameLog.mockResolvedValue([]);
        mocks.queryLatestSessions.mockReset();
        mocks.queryLatestSessions.mockResolvedValue([]);
    });

    it('loads the complete configured table result instead of one page', async () => {
        renderHook(() =>
            useGameLogRows({
                deferredSearchQuery: '',
                favoritesOnly: false,
                filters: [],
                preferencesReady: true,
                refreshToken: 0,
                sessionDateFrom: '',
                sessionDateTo: '',
                sessionLimit: 25,
                viewMode: 'table'
            })
        );

        await waitFor(() => expect(mocks.queryGameLog).toHaveBeenCalled());

        expect(mocks.queryGameLog).toHaveBeenCalledWith({
            currentUserId: 'usr_self',
            search: '',
            filters: [],
            favoriteUserIds: [],
            dateFrom: '',
            dateTo: '',
            limit: undefined
        });
    });

    it('refreshes only the live session head while the game log grows', async () => {
        const loaded = [3, 2, 1].map(session);
        mocks.queryLatestSessions.mockResolvedValueOnce(loaded);
        const { result, rerender } = renderHook(
            (options) => useGameLogRows(options),
            { initialProps: sessionOptions }
        );
        await waitFor(() => expect(result.current.sessions).toBe(loaded));

        const grown = { ...session(3), duration: 30_000 };
        mocks.queryLatestSessions.mockResolvedValueOnce([
            session(4),
            grown,
            session(2)
        ]);
        mocks.liveEventCount = 1;
        rerender(sessionOptions);

        await waitFor(() =>
            expect(result.current.sessions.map(({ id }) => id)).toEqual([
                4, 3, 2, 1
            ])
        );
        expect(mocks.queryLatestSessions).toHaveBeenLastCalledWith(
            expect.objectContaining({ limit: 3 })
        );
        expect(result.current.sessions[1]).toBe(grown);
        expect(result.current.sessions[2]).toBe(loaded[1]);
        expect(result.current.loadStatus).toBe('ready');
    });

    it('defers live head refreshes until a load-more query finishes', async () => {
        mocks.queryLatestSessions.mockResolvedValueOnce([2, 1].map(session));
        const { result, rerender } = renderHook(
            (options) => useGameLogRows(options),
            { initialProps: sessionOptions }
        );
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

        const loadMore = deferred<GameLogSession[]>();
        mocks.queryLatestSessions.mockReturnValueOnce(loadMore.promise);
        rerender({ ...sessionOptions, sessionLimit: 40 });
        await waitFor(() =>
            expect(mocks.queryLatestSessions).toHaveBeenCalledTimes(2)
        );

        mocks.liveEventCount = 1;
        rerender({ ...sessionOptions, sessionLimit: 40 });
        expect(mocks.queryLatestSessions).toHaveBeenCalledTimes(2);

        mocks.queryLatestSessions.mockResolvedValueOnce([3, 2].map(session));
        await act(async () => {
            loadMore.resolve([2, 1, 0].map(session));
        });

        await waitFor(() =>
            expect(result.current.sessions.map(({ id }) => id)).toEqual([
                3, 2, 1, 0
            ])
        );
        expect(mocks.queryLatestSessions).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ limit: 3 })
        );
    });

    it('reloads the full table for live events outside the sessions view', async () => {
        const tableOptions = { ...sessionOptions, viewMode: 'table' as const };
        const { rerender } = renderHook((options) => useGameLogRows(options), {
            initialProps: tableOptions
        });
        await waitFor(() =>
            expect(mocks.queryGameLog).toHaveBeenCalledTimes(1)
        );

        mocks.liveEventCount = 1;
        rerender(tableOptions);

        await waitFor(() =>
            expect(mocks.queryGameLog).toHaveBeenCalledTimes(2)
        );
        expect(mocks.queryLatestSessions).not.toHaveBeenCalled();
    });
});
