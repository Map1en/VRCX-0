// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedReadModelResult } from '@/domain/feed/feedReadModelTypes';

const mocks = vi.hoisted(() => ({
    queryFeedReadModel: vi.fn(),
    queryFeedPage: vi.fn(),
    mergeLiveRows: vi.fn(),
    runtime: { auth: { currentUserId: 'usr_self' } },
    session: { isFavoritesLoaded: true },
    favorites: {
        remoteFavoritesById: {} as Record<string, unknown>,
        localFriendFavorites: {} as Record<string, unknown>
    },
    preferences: { feedHiddenUsers: [] as string[] }
}));

vi.mock('@/repositories/feedRepository', () => ({
    default: {
        queryFeedReadModel: mocks.queryFeedReadModel,
        queryFeedPage: mocks.queryFeedPage,
        mergeLiveRows: mocks.mergeLiveRows
    }
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

import { useFeedLiveStore } from '@/state/feedLiveStore';

import type { FeedColumnConfig } from '../feedColumnsState';
import type { Deferred, MergeArgs } from '../feedLiveMergeTestUtils';
import {
    createDeferred,
    flush,
    mergeCallArgsOf,
    pushLiveEntry
} from '../feedLiveMergeTestUtils';
import type { FeedRow } from '../feedTypes';
import {
    resolveFeedColumnInitialLiveSequence,
    useFeedColumnRows
} from './useFeedColumnRows';

function createColumn(id: string): FeedColumnConfig {
    return {
        id,
        title: id,
        width: 320,
        friendScope: { kind: 'all' },
        feedTypes: []
    };
}

const mergeCallArgs = () => mergeCallArgsOf(mocks.mergeLiveRows);

function renderColumnRows(column: FeedColumnConfig) {
    return renderHook(
        (nextColumn: FeedColumnConfig) => useFeedColumnRows(nextColumn),
        { initialProps: column }
    );
}

describe('feed column rows helpers', () => {
    it('uses the current live sequence as the initial merge floor', () => {
        expect(resolveFeedColumnInitialLiveSequence(7)).toBe(7);
        expect(resolveFeedColumnInitialLiveSequence('9')).toBe(9);
        expect(resolveFeedColumnInitialLiveSequence(-1)).toBe(0);
        expect(resolveFeedColumnInitialLiveSequence('bad')).toBe(0);
    });
});

describe('useFeedColumnRows', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        useFeedLiveStore.getState().resetFeedLive();
        mocks.queryFeedReadModel.mockResolvedValue({
            rows: [],
            maxSequence: 0
        });
        mocks.queryFeedPage.mockResolvedValue([]);
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

    it('discards a full query result once the column changed', async () => {
        const staleQuery = createDeferred<FeedReadModelResult<FeedRow>>();
        const freshQuery = createDeferred<FeedReadModelResult<FeedRow>>();
        mocks.queryFeedReadModel
            .mockReturnValueOnce(staleQuery.promise)
            .mockReturnValueOnce(freshQuery.promise);

        const { result, rerender } = renderColumnRows(createColumn('first'));

        expect(result.current.loadStatus).toBe('running');

        rerender(createColumn('second'));

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

        const { result } = renderColumnRows(createColumn('first'));
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

    it('ignores live entries at or below the committed sequence', async () => {
        mocks.queryFeedReadModel.mockResolvedValue({
            rows: [{ userId: 'base' }],
            maxSequence: 5
        });
        mocks.mergeLiveRows.mockImplementation(async ({ rows }: MergeArgs) => ({
            rows,
            maxSequence: 5
        }));

        const { result } = renderColumnRows(createColumn('first'));
        await flush();

        expect(result.current.loadStatus).toBe('ready');

        mocks.mergeLiveRows.mockClear();
        for (let index = 0; index < 5; index += 1) {
            pushLiveEntry(`live-${index}`);
        }
        await flush();

        expect(mocks.mergeLiveRows).not.toHaveBeenCalled();

        pushLiveEntry('live-6');
        await flush();

        expect(mergeCallArgs()).toHaveLength(1);
        expect(mergeCallArgs()[0].minLiveSequence).toBe(5);
    });

    it('merges live entries from the committed high-water sequence', async () => {
        mocks.queryFeedReadModel.mockResolvedValue({
            rows: [{ userId: 'base' }],
            maxSequence: 2
        });
        mocks.mergeLiveRows.mockImplementation(async ({ rows }: MergeArgs) => ({
            rows,
            maxSequence: 2
        }));

        const { result } = renderColumnRows(createColumn('first'));
        await flush();

        mocks.mergeLiveRows.mockClear();
        for (let index = 0; index < 3; index += 1) {
            pushLiveEntry(`live-${index}`);
        }
        await flush();

        expect(mergeCallArgs()).toHaveLength(1);
        expect(mergeCallArgs()[0].minLiveSequence).toBe(2);
        expect(mergeCallArgs()[0].maxRows).toBe(81);
        expect(result.current.rows).toEqual([{ userId: 'base' }]);
    });

    it('keeps merging until the live version is caught up', async () => {
        mocks.queryFeedReadModel.mockResolvedValue({
            rows: [{ userId: 'base' }],
            maxSequence: 0
        });

        const { result } = renderColumnRows(createColumn('first'));
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
