// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    FavoriteGroupMap,
    FavoriteRecord
} from '@/domain/favorites/types';

const mocks = vi.hoisted(() => ({
    queryFeedLatest: vi.fn(),
    queryFeedPage: vi.fn(),
    queryFeed: vi.fn(),
    getFriendLogCurrent: vi.fn(),
    getAllUserStats: vi.fn(),
    runtime: { auth: { currentUserId: 'usr_self' } },
    session: { isFavoritesLoaded: true },
    favorites: {
        remoteFavoritesById: {} as Record<string, FavoriteRecord>,
        localFriendFavorites: {} as FavoriteGroupMap
    },
    preferences: {
        localFavoriteFriendsGroups: [] as string[],
        feedHiddenUsers: [] as string[],
        feedPersistenceDisabled: false,
        tableLimits: { maxTableSize: 100 }
    },
    friendLog: { revision: 0 }
}));

vi.mock('@/repositories/feedRepository', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/repositories/feedRepository')>()),
    default: {
        queryFeedLatest: mocks.queryFeedLatest,
        queryFeedPage: mocks.queryFeedPage,
        queryFeed: mocks.queryFeed
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
    usePreferencesStore: Object.assign(
        <T>(selector: (state: typeof mocks.preferences) => T): T =>
            selector(mocks.preferences),
        { getState: () => mocks.preferences }
    )
}));

vi.mock('@/state/friendLogStore', () => ({
    useFriendLogStore: <T>(selector: (state: typeof mocks.friendLog) => T): T =>
        selector(mocks.friendLog)
}));

import { gpsFeedEntry } from '@/components/feed/feedLiveTestEntries';
import type { FeedFilterType, FeedRow } from '@/components/feed/feedTypes';
import { useFeedLiveStore } from '@/state/feedLiveStore';

import { createDeferred, flush, pushLiveEntry } from './feedLiveMergeTestUtils';
import { useFeedRows } from './useFeedRows';

type FeedRowsProps = {
    activeFilters: FeedFilterType[];
    dateFrom: string;
    dateTo: string;
    deferredSearchQuery: string;
    favoritesOnly: boolean;
    scopedUserIds: readonly string[];
    preferencesReady: boolean;
};

const BASE_PROPS: FeedRowsProps = {
    activeFilters: [],
    dateFrom: '',
    dateTo: '',
    deferredSearchQuery: '',
    favoritesOnly: false,
    scopedUserIds: [],
    preferencesReady: true
};

function renderFeedRows() {
    return renderHook((props: FeedRowsProps) => useFeedRows(props), {
        initialProps: BASE_PROPS
    });
}

describe('useFeedRows', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.preferences.feedPersistenceDisabled = false;
        mocks.preferences.tableLimits.maxTableSize = 100;
        mocks.friendLog.revision = 0;
        useFeedLiveStore.getState().resetFeedLive();
        mocks.getFriendLogCurrent.mockResolvedValue([]);
        mocks.getAllUserStats.mockResolvedValue([]);
        mocks.queryFeedLatest.mockResolvedValue({ rows: [], maxSequence: 0 });
        mocks.queryFeedPage.mockResolvedValue([]);
        mocks.queryFeed.mockResolvedValue([]);
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('loads the latest snapshot and applies realtime rows without another IPC', async () => {
        mocks.queryFeedLatest.mockResolvedValue({
            rows: [{ userId: 'usr_base' }],
            maxSequence: 0
        });
        const { result } = renderFeedRows();
        await flush();

        pushLiveEntry('live');
        await flush();

        expect(result.current.rows.map((row) => row.userId)).toEqual([
            'usr_live',
            'usr_base'
        ]);
        expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(1);
        expect(mocks.queryFeed).not.toHaveBeenCalled();
    });

    it('loads older cursor pages without trimming them when realtime rows arrive', async () => {
        const persistedCursor = {
            createdAt: '2026-05-15T00:00:00.000Z',
            sourceRank: 60,
            rowId: 80
        };
        mocks.queryFeedLatest.mockResolvedValue({
            rows: [
                {
                    created_at: persistedCursor.createdAt,
                    rowId: persistedCursor.rowId,
                    sourceRank: persistedCursor.sourceRank,
                    type: 'GPS',
                    userId: 'usr_base'
                }
            ],
            maxSequence: 0,
            persistedCursor,
            persistedHasMore: true
        });
        const olderRows = Array.from({ length: 80 }, (_, index) => ({
            created_at: `2026-05-14T00:${String(59 - (index % 60)).padStart(2, '0')}:00.000Z`,
            rowId: 100 + index,
            sourceRank: 60,
            type: 'GPS',
            userId: `usr_older_${index}`
        }));
        mocks.queryFeedPage.mockResolvedValue(olderRows);
        const { result } = renderFeedRows();
        await flush();

        expect(mocks.queryFeedLatest).toHaveBeenCalledWith(
            expect.objectContaining({ maxRows: 80 })
        );
        act(() => result.current.loadOlder());
        await flush();
        expect(mocks.queryFeedPage).toHaveBeenCalledWith(
            expect.objectContaining({ cursor: persistedCursor, maxEntries: 80 })
        );
        expect(result.current.rows).toHaveLength(81);

        pushLiveEntry('live-after-older');
        await flush();

        expect(result.current.rows).toHaveLength(82);
        expect(result.current.rows[0].userId).toBe('usr_live-after-older');
        expect(result.current.rows.at(-1)?.userId).toBe('usr_older_79');
    });

    it('caps the latest window and pages from the retained tail', async () => {
        const rows = Array.from({ length: 80 }, (_, index) => ({
            created_at: `2026-05-15T00:${String(59 - (index % 60)).padStart(2, '0')}:00.000Z`,
            rowId: index + 1,
            sourceRank: 60,
            type: 'GPS',
            userId: `usr_base_${index}`
        }));
        mocks.queryFeedLatest.mockResolvedValue({
            rows,
            maxSequence: 0,
            persistedCursor: {
                createdAt: rows[79].created_at,
                sourceRank: 60,
                rowId: 80
            },
            persistedHasMore: false
        });
        const { result } = renderFeedRows();
        await flush();

        for (let index = 0; index < 21; index += 1) {
            pushLiveEntry(`latest_${index}`);
        }
        await act(async () => {
            vi.advanceTimersByTime(250);
        });
        await flush();

        expect(result.current.rows).toHaveLength(100);
        expect(result.current.rows[0].userId).toBe('usr_latest_20');
        expect(result.current.rows.at(-1)?.rowId).toBe(79);
        expect(result.current.hasMore).toBe(true);

        act(() => result.current.loadOlder());
        await flush();
        expect(mocks.queryFeedPage).toHaveBeenCalledWith(
            expect.objectContaining({
                cursor: {
                    createdAt: rows[78].created_at,
                    sourceRank: 60,
                    rowId: 79
                }
            })
        );
    });

    it('drops newer rows while browsing old pages and reloads latest on demand', async () => {
        const initialRows = Array.from({ length: 80 }, (_, index) => ({
            created_at: `2026-05-15T00:${String(59 - (index % 60)).padStart(2, '0')}:00.000Z`,
            rowId: index + 1,
            sourceRank: 60,
            type: 'GPS',
            userId: `usr_initial_${index}`
        }));
        const olderRows = Array.from({ length: 80 }, (_, index) => ({
            created_at: `2026-05-14T00:${String(59 - (index % 60)).padStart(2, '0')}:00.000Z`,
            rowId: 100 + index,
            sourceRank: 60,
            type: 'GPS',
            userId: `usr_older_${index}`
        }));
        mocks.queryFeedLatest
            .mockResolvedValueOnce({
                rows: initialRows,
                maxSequence: 0,
                persistedCursor: {
                    createdAt: initialRows[79].created_at,
                    sourceRank: 60,
                    rowId: 80
                },
                persistedHasMore: true
            })
            .mockResolvedValueOnce({
                rows: [{ userId: 'usr_reloaded_latest' }],
                maxSequence: 0,
                persistedHasMore: false
            });
        mocks.queryFeedPage.mockResolvedValue(olderRows);
        const { result } = renderFeedRows();
        await flush();

        act(() => {
            result.current.setViewingLatest(false);
            result.current.loadOlder();
        });
        await flush();

        expect(result.current.rows).toHaveLength(100);
        expect(result.current.rows[0].userId).toBe('usr_initial_60');
        expect(result.current.rows.at(-1)?.userId).toBe('usr_older_79');
        expect(result.current.hasUnloadedLatest).toBe(true);

        act(() => result.current.reloadLatest());
        await flush();

        expect(result.current.rows).toEqual([
            { userId: 'usr_reloaded_latest' }
        ]);
        expect(result.current.hasUnloadedLatest).toBe(false);
        expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(2);
    });

    it('applies a correction event even when no upsert remains in the frontend buffer', async () => {
        mocks.queryFeedLatest.mockResolvedValue({
            rows: [
                {
                    rowId: 1,
                    sourceRank: 60,
                    type: 'GPS',
                    worldName: 'wrld_1'
                }
            ],
            maxSequence: 0
        });
        const { result } = renderFeedRows();
        await flush();

        act(() => {
            useFeedLiveStore.getState().pushPatches([
                {
                    sequence: 1,
                    id: 'row:GPS:60:1',
                    fields: { worldName: 'Resolved World' }
                }
            ]);
        });
        await flush();

        expect(result.current.rows[0].worldName).toBe('Resolved World');
        expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(1);
    });

    it('projects every field of a realtime entry onto its row', async () => {
        const { result } = renderFeedRows();
        await flush();

        act(() => {
            useFeedLiveStore.getState().pushEntries(
                [
                    {
                        sequence: 1,
                        entry: gpsFeedEntry({
                            created_at: '2026-05-15T00:00:00Z',
                            userId: 'usr_gps',
                            displayName: 'GPS Friend',
                            location: 'wrld_1:instance',
                            worldName: 'GPS World',
                            time: 1500
                        })
                    }
                ],
                { ownerUserId: 'usr_self' }
            );
        });
        await flush();

        expect(result.current.rows[0]).toMatchObject({
            userId: 'usr_gps',
            displayName: 'GPS Friend',
            worldName: 'GPS World',
            time: 1500
        });
    });

    it('keeps search results static while realtime entries continue arriving', async () => {
        mocks.queryFeed.mockResolvedValue([{ userId: 'usr_search' }]);
        const { result } = renderHook(
            (props: FeedRowsProps) => useFeedRows(props),
            {
                initialProps: {
                    ...BASE_PROPS,
                    deferredSearchQuery: 'needle'
                }
            }
        );
        await flush();

        pushLiveEntry('ignored-by-search');
        await act(async () => {
            vi.advanceTimersByTime(250);
        });
        await flush();

        expect(result.current.rows).toEqual([{ userId: 'usr_search' }]);
        expect(mocks.queryFeed).toHaveBeenCalledWith(
            expect.objectContaining({ search: 'needle' })
        );
        expect(mocks.queryFeed.mock.calls[0]?.[0]).not.toHaveProperty(
            'maxEntries'
        );
        expect(mocks.queryFeedLatest).not.toHaveBeenCalled();
    });

    it('uses the search query path for a selected friend scope', async () => {
        const { result } = renderHook(
            (props: FeedRowsProps) => useFeedRows(props),
            {
                initialProps: {
                    ...BASE_PROPS,
                    scopedUserIds: ['usr_friend']
                }
            }
        );
        await flush();

        expect(result.current.loadStatus).toBe('ready');
        expect(mocks.queryFeed).toHaveBeenCalledWith(
            expect.objectContaining({ scopedUserIds: ['usr_friend'] })
        );
        expect(mocks.queryFeed.mock.calls[0]?.[0]).not.toHaveProperty(
            'maxEntries'
        );
        expect(mocks.queryFeedLatest).not.toHaveBeenCalled();
    });

    it('reloads the latest snapshot after search is cleared', async () => {
        mocks.queryFeed.mockResolvedValue([{ userId: 'usr_search' }]);
        mocks.queryFeedLatest.mockResolvedValue({
            rows: [{ userId: 'usr_latest' }],
            maxSequence: 4
        });
        const { result, rerender } = renderHook(
            (props: FeedRowsProps) => useFeedRows(props),
            {
                initialProps: {
                    ...BASE_PROPS,
                    deferredSearchQuery: 'needle'
                }
            }
        );
        await flush();

        rerender(BASE_PROPS);
        await flush();

        expect(result.current.rows).toEqual([{ userId: 'usr_latest' }]);
        expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(1);
    });

    it('does not let a stale search response overwrite the resynced latest rows', async () => {
        const search = createDeferred<FeedRow[]>();
        mocks.queryFeed.mockReturnValue(search.promise);
        mocks.queryFeedLatest.mockResolvedValue({
            rows: [{ userId: 'usr_latest' }],
            maxSequence: 0
        });
        const { result, rerender } = renderHook(
            (props: FeedRowsProps) => useFeedRows(props),
            {
                initialProps: {
                    ...BASE_PROPS,
                    deferredSearchQuery: 'needle'
                }
            }
        );

        rerender(BASE_PROPS);
        await flush();
        await act(async () => {
            search.resolve([{ userId: 'usr_stale' }]);
        });
        await flush();

        expect(result.current.rows).toEqual([{ userId: 'usr_latest' }]);
    });

    it('uses the Rust latest snapshot when persistence is disabled', async () => {
        mocks.preferences.feedPersistenceDisabled = true;
        const { result } = renderFeedRows();
        await flush();

        expect(result.current.loadStatus).toBe('ready');
        expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(1);
        expect(mocks.queryFeed).not.toHaveBeenCalled();
    });

    it('accepts restarted Rust sequences after the persistence mode changes', async () => {
        mocks.queryFeedLatest.mockResolvedValue({ rows: [], maxSequence: 9 });
        const { result, rerender } = renderFeedRows();
        await flush();

        useFeedLiveStore.getState().resetFeedLive();
        mocks.preferences.feedPersistenceDisabled = true;
        mocks.queryFeedLatest.mockResolvedValue({ rows: [], maxSequence: 0 });
        rerender(BASE_PROPS);
        await flush();

        pushLiveEntry('restarted');
        await flush();

        expect(result.current.rows.map((row) => row.userId)).toEqual([
            'usr_restarted'
        ]);
    });
});
