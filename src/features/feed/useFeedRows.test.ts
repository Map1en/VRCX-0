// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedReadModelResult } from '@/domain/feed/feedReadModelTypes';

const mocks = vi.hoisted(() => ({
    queryFeedReadModel: vi.fn(),
    mergeLiveRows: vi.fn(),
    getFriendLogCurrent: vi.fn(),
    getAllUserStats: vi.fn(),
    runtime: { auth: { currentUserId: 'usr_self' } },
    session: { isFavoritesLoaded: true },
    favorites: {
        remoteFavoritesById: {} as Record<string, unknown>,
        localFriendFavorites: {} as Record<string, unknown>
    },
    preferences: {
        localFavoriteFriendsGroups: [] as string[],
        feedHiddenUsers: [] as string[],
        tableLimits: { maxTableSize: 100 }
    },
    friendRoster: { lastLoadedAt: 0 }
}));

vi.mock('@/repositories/feedRepository', () => ({
    default: {
        queryFeedReadModel: mocks.queryFeedReadModel,
        mergeLiveRows: mocks.mergeLiveRows
    }
}));

vi.mock('@/repositories/friendLogRepository', () => ({
    default: { getFriendLogCurrent: mocks.getFriendLogCurrent }
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: { getAllUserStats: mocks.getAllUserStats }
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T>(selector: (state: typeof mocks.runtime) => T): T =>
        selector(mocks.runtime)
}));

vi.mock('@/state/sessionStore', () => ({
    useSessionStore: <T>(selector: (state: typeof mocks.session) => T): T =>
        selector(mocks.session)
}));

vi.mock('@/state/favoriteStore', () => ({
    useFavoriteStore: <T>(selector: (state: typeof mocks.favorites) => T): T =>
        selector(mocks.favorites)
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: <T>(
        selector: (state: typeof mocks.preferences) => T
    ): T => selector(mocks.preferences)
}));

vi.mock('@/state/friendRosterStore', () => ({
    useFriendRosterStore: <T>(
        selector: (state: typeof mocks.friendRoster) => T
    ): T => selector(mocks.friendRoster)
}));

import { useFeedLiveStore } from '@/state/feedLiveStore';

import type { Deferred, MergeArgs } from './feedLiveMergeTestUtils';
import {
    createDeferred,
    flush,
    mergeCallArgsOf,
    pushLiveEntry
} from './feedLiveMergeTestUtils';
import type { FeedFilterType, FeedRow } from './feedTypes';
import { useFeedRows } from './useFeedRows';

type FeedRowsProps = {
    activeFilters: FeedFilterType[];
    dateFrom: string;
    dateTo: string;
    deferredSearchQuery: string;
    favoritesOnly: boolean;
    preferencesReady: boolean;
};

const ACTIVE_FILTERS: FeedFilterType[] = [];

const BASE_PROPS: FeedRowsProps = {
    activeFilters: ACTIVE_FILTERS,
    dateFrom: '',
    dateTo: '',
    deferredSearchQuery: '',
    favoritesOnly: false,
    preferencesReady: true
};

const mergeCallArgs = () => mergeCallArgsOf(mocks.mergeLiveRows);

function renderFeedRows() {
    return renderHook((props: FeedRowsProps) => useFeedRows(props), {
        initialProps: BASE_PROPS
    });
}

describe('useFeedRows', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        useFeedLiveStore.getState().resetFeedLive();
        mocks.getFriendLogCurrent.mockResolvedValue([]);
        mocks.getAllUserStats.mockResolvedValue([]);
        mocks.queryFeedReadModel.mockResolvedValue({
            rows: [],
            maxSequence: 0
        });
        mocks.mergeLiveRows.mockImplementation(
            async ({ rows, minLiveSequence }: MergeArgs) => ({
                rows,
                maxSequence: minLiveSequence
            })
        );
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('discards a full query result once the dependencies changed', async () => {
        const staleQuery = createDeferred<FeedReadModelResult<FeedRow>>();
        const freshQuery = createDeferred<FeedReadModelResult<FeedRow>>();
        mocks.queryFeedReadModel
            .mockReturnValueOnce(staleQuery.promise)
            .mockReturnValueOnce(freshQuery.promise);

        const { result, rerender } = renderFeedRows();

        expect(result.current.loadStatus).toBe('running');

        rerender({ ...BASE_PROPS, deferredSearchQuery: 'later' });

        await act(async () => {
            staleQuery.resolve({ rows: [{ userId: 'stale' }], maxSequence: 0 });
        });
        await flush();

        expect(result.current.rows).toEqual([]);
        expect(mocks.mergeLiveRows).not.toHaveBeenCalled();

        await act(async () => {
            freshQuery.resolve({ rows: [{ userId: 'fresh' }], maxSequence: 0 });
        });
        await flush();

        expect(result.current.rows).toEqual([{ userId: 'fresh' }]);
        expect(result.current.loadStatus).toBe('ready');
        expect(mocks.queryFeedReadModel).toHaveBeenCalledTimes(2);
    });

    it('discards a live merge that a newer merge superseded', async () => {
        mocks.queryFeedReadModel.mockResolvedValue({
            rows: [{ userId: 'base' }],
            maxSequence: 0
        });

        const { result } = renderFeedRows();
        await flush();

        expect(result.current.rows).toEqual([{ userId: 'base' }]);

        const merges: Deferred<FeedReadModelResult<FeedRow>>[] = [];
        mocks.mergeLiveRows.mockImplementation(() => {
            const deferred = createDeferred<FeedReadModelResult<FeedRow>>();
            merges.push(deferred);
            return deferred.promise;
        });

        pushLiveEntry('live-1');

        expect(merges).toHaveLength(1);

        pushLiveEntry('live-2');
        await act(async () => {
            vi.advanceTimersByTime(250);
        });

        expect(merges).toHaveLength(2);

        await act(async () => {
            merges[0].resolve({
                rows: [{ userId: 'stale-live' }],
                maxSequence: 1
            });
        });
        await flush();

        expect(result.current.rows).toEqual([{ userId: 'base' }]);

        await act(async () => {
            merges[1].resolve({
                rows: [{ userId: 'fresh-live' }],
                maxSequence: 2
            });
        });
        await flush();

        expect(result.current.rows).toEqual([{ userId: 'fresh-live' }]);
    });

    it('skips the extra commit merge while the live version is already covered', async () => {
        mocks.queryFeedReadModel.mockResolvedValue({
            rows: [{ userId: 'base' }],
            maxSequence: 5
        });
        mocks.mergeLiveRows.mockImplementation(async ({ rows }: MergeArgs) => ({
            rows,
            maxSequence: 5
        }));

        const { result } = renderFeedRows();
        await flush();

        expect(result.current.rows).toEqual([{ userId: 'base' }]);
        expect(mocks.mergeLiveRows).toHaveBeenCalledTimes(1);
    });

    it('merges live entries from the committed high-water sequence', async () => {
        mocks.queryFeedReadModel.mockResolvedValue({
            rows: [{ userId: 'base' }],
            maxSequence: 5
        });
        mocks.mergeLiveRows.mockImplementation(async ({ rows }: MergeArgs) => ({
            rows,
            maxSequence: 5
        }));

        const { result } = renderFeedRows();
        await flush();

        mocks.mergeLiveRows.mockClear();
        pushLiveEntry('live-1');
        await flush();

        expect(mergeCallArgs()).toHaveLength(1);
        expect(mergeCallArgs()[0].minLiveSequence).toBe(5);
        expect(mergeCallArgs()[0].maxRows).toBe(100);
        expect(result.current.rows).toEqual([{ userId: 'base' }]);
    });

    it('keeps merging until the live version is caught up', async () => {
        mocks.queryFeedReadModel.mockResolvedValue({
            rows: [{ userId: 'base' }],
            maxSequence: 0
        });

        const { result } = renderFeedRows();
        await flush();

        mocks.mergeLiveRows.mockClear();
        mocks.mergeLiveRows.mockImplementation(async () => {
            if (mocks.mergeLiveRows.mock.calls.length === 1) {
                await Promise.resolve();
                useFeedLiveStore
                    .getState()
                    .pushEntry({ id: 'live-2', type: 'Online' });
                return { rows: [{ userId: 'a' }], maxSequence: 1 };
            }
            return {
                rows: [{ userId: 'a' }, { userId: 'b' }],
                maxSequence: 2
            };
        });

        pushLiveEntry('live-1');
        await flush();

        expect(mergeCallArgs().map((args) => args.minLiveSequence)).toEqual([
            0, 1
        ]);
        expect(result.current.rows).toEqual([{ userId: 'a' }, { userId: 'b' }]);
    });
});
