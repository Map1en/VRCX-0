// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import friendLogHistoryRepository from '@/repositories/friendLogHistoryRepository';
import { useFriendLogStore } from '@/state/friendLogStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { FriendLogRow } from './friendLogRows';
import { useFriendLogRows } from './useFriendLogRows';

vi.mock('@/repositories/friendLogHistoryRepository', () => ({
    default: { getFriendLogHistory: vi.fn() }
}));
vi.mock('./useFriendLogResolvedNames', () => ({
    useFriendLogResolvedNames: () => (row: FriendLogRow) => row.displayName
}));

const data: FriendLogRow[] = Array.from({ length: 180 }, (_, index) => ({
    rowId: 180 - index,
    created_at: '2026-09-01T00:00:00.000Z',
    type: index % 2 ? 'Friend' : 'Unfriend',
    userId: `usr_${180 - index}`,
    displayName: `Name ${180 - index}`,
    friendNumber: 0
}));
const initial = {
    refreshToken: 0,
    searchQuery: '',
    selectedTypes: [] as string[],
    dateFrom: '',
    dateTo: ''
};

beforeEach(() => {
    vi.resetAllMocks();
    useRuntimeStore.setState((state) => ({
        auth: {
            ...state.auth,
            currentUserId: 'usr_owner',
            currentUserEndpoint: 'default'
        }
    }));
    usePreferencesStore.setState((state) => ({
        hideUnfriends: false,
        tableLimits: { ...state.tableLimits, maxTableSize: 160 }
    }));
    vi.mocked(
        friendLogHistoryRepository.getFriendLogHistory
    ).mockImplementation(async (_owner, options = {}) => {
        const rows = data.filter(
            (row) =>
                (!options.cursor || row.rowId < options.cursor.rowId) &&
                (!options.types?.length || options.types.includes(row.type)) &&
                !options.excludedTypes?.includes(row.type)
        );
        return options.limit ? rows.slice(0, options.limit) : rows;
    });
});
afterEach(cleanup);

describe('Friend History browsing and search', () => {
    it('loads older cursor pages once, bounds the retained window, and reloads the latest on demand', async () => {
        const { result } = renderHook(() => useFriendLogRows(initial));
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        expect(result.current.rows).toHaveLength(80);
        expect(result.current.searchMode).toBe(false);
        act(() => {
            result.current.loadOlder();
            result.current.loadOlder();
        });
        await waitFor(() => expect(result.current.rows).toHaveLength(160));
        expect(
            friendLogHistoryRepository.getFriendLogHistory
        ).toHaveBeenCalledTimes(2);
        expect(
            vi.mocked(friendLogHistoryRepository.getFriendLogHistory).mock
                .lastCall?.[1]?.cursor?.rowId
        ).toBe(101);
        act(() => result.current.loadOlder());
        await waitFor(() => expect(result.current.hasMore).toBe(false));
        expect(result.current.rows).toHaveLength(160);
        expect(result.current.rows[0].rowId).toBe(160);
        expect(result.current.rows[159].rowId).toBe(1);
        expect(result.current.hasUnloadedLatest).toBe(true);
        act(() => result.current.reloadLatest());
        await waitFor(() => expect(result.current.rows[0]?.rowId).toBe(180));
        expect(result.current.rows).toHaveLength(80);
        expect(result.current.hasUnloadedLatest).toBe(false);
    });

    it('searches beyond the loaded window and returns to browsing after clearing the query', async () => {
        const { result, rerender } = renderHook(useFriendLogRows, {
            initialProps: initial
        });
        await waitFor(() => expect(result.current.rows).toHaveLength(80));
        rerender({ ...initial, searchQuery: 'Name 1' });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        expect(result.current.searchMode).toBe(true);
        expect(
            vi.mocked(friendLogHistoryRepository.getFriendLogHistory).mock
                .lastCall?.[1]?.limit
        ).toBeUndefined();
        expect(result.current.orderedRows.some((row) => row.rowId === 1)).toBe(
            true
        );
        const calls = vi.mocked(friendLogHistoryRepository.getFriendLogHistory)
            .mock.calls.length;
        act(() => result.current.loadOlder());
        expect(
            friendLogHistoryRepository.getFriendLogHistory
        ).toHaveBeenCalledTimes(calls);
        rerender(initial);
        await waitFor(() => expect(result.current.rows).toHaveLength(80));
        expect(result.current.searchMode).toBe(false);
    });

    it('applies whole local days without requiring a name, and keeps type-only filters in browsing mode', async () => {
        const { result, rerender } = renderHook(useFriendLogRows, {
            initialProps: initial
        });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        rerender({ ...initial, dateFrom: '2026-09-01', dateTo: '2026-09-02' });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        expect(result.current.searchMode).toBe(true);
        expect(
            vi.mocked(friendLogHistoryRepository.getFriendLogHistory).mock
                .lastCall?.[1]
        ).toMatchObject({
            dateFrom: new Date(2026, 8, 1).toISOString(),
            dateTo: new Date(2026, 8, 2, 23, 59, 59, 999).toISOString()
        });
        rerender({ ...initial, selectedTypes: ['Friend'] });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        expect(result.current.searchMode).toBe(false);
        expect(result.current.rows.every((row) => row.type === 'Friend')).toBe(
            true
        );
    });

    it('keeps scrolled history stable and refreshes search results after a revision', async () => {
        const { result, rerender } = renderHook(useFriendLogRows, {
            initialProps: initial
        });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        const rows = result.current.rows;
        act(() => result.current.setViewingLatest(false));
        act(() => useFriendLogStore.getState().bumpRevision());
        expect(result.current.rows).toBe(rows);
        expect(result.current.hasUnloadedLatest).toBe(true);
        expect(
            friendLogHistoryRepository.getFriendLogHistory
        ).toHaveBeenCalledTimes(1);
        rerender({ ...initial, searchQuery: 'Name' });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        const count = vi.mocked(friendLogHistoryRepository.getFriendLogHistory)
            .mock.calls.length;
        await act(async () => {
            useFriendLogStore.getState().bumpRevision();
        });
        await waitFor(() =>
            expect(
                friendLogHistoryRepository.getFriendLogHistory
            ).toHaveBeenCalledTimes(count + 1)
        );
    });

    it('preserves a trimmed window during manual refresh', async () => {
        const { result, rerender } = renderHook(useFriendLogRows, {
            initialProps: initial
        });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        await act(async () => result.current.loadOlder());
        await act(async () => result.current.loadOlder());
        expect(result.current.rows[0].rowId).toBe(160);
        rerender({ ...initial, refreshToken: 1 });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        expect(result.current.rows[0].rowId).toBe(160);
        expect(result.current.rows).toHaveLength(160);
    });

    it('does not resurrect a deleted row when a pending refresh returns its old snapshot', async () => {
        const { result, rerender } = renderHook(useFriendLogRows, {
            initialProps: initial
        });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        let finish: (rows: FriendLogRow[]) => void = () => {};
        vi.mocked(
            friendLogHistoryRepository.getFriendLogHistory
        ).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        rerender({ ...initial, refreshToken: 1 });
        act(() => result.current.removeRow(data[0]));
        await act(async () => finish(data.slice(0, 80)));
        expect(
            result.current.rows.some((row) => row.rowId === data[0].rowId)
        ).toBe(false);
        expect(result.current.rows).toHaveLength(79);
    });

    it('allows a fresh record to reuse a deleted SQLite row id on the next refresh', async () => {
        const { result, rerender } = renderHook(useFriendLogRows, {
            initialProps: initial
        });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        act(() => result.current.removeRow(data[0]));
        const replacement = {
            ...data[0],
            created_at: '2026-09-02T00:00:00.000Z',
            displayName: 'New event'
        };
        vi.mocked(
            friendLogHistoryRepository.getFriendLogHistory
        ).mockResolvedValueOnce([replacement]);
        rerender({ ...initial, refreshToken: 1 });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        expect(result.current.rows).toEqual([replacement]);
    });

    it('retains rows on an older-page error and retries the same cursor', async () => {
        const { result } = renderHook(() => useFriendLogRows(initial));
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        vi.mocked(
            friendLogHistoryRepository.getFriendLogHistory
        ).mockRejectedValueOnce(new Error('query failed'));
        await act(async () => result.current.loadOlder());
        expect(result.current.loadOlderFailed).toBe(true);
        expect(result.current.rows).toHaveLength(80);
        await act(async () => result.current.loadOlder());
        expect(result.current.rows).toHaveLength(160);
        expect(result.current.loadOlderFailed).toBe(false);
    });

    it('discards a late older page after switching to search', async () => {
        const { result, rerender } = renderHook(useFriendLogRows, {
            initialProps: initial
        });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        let finish: (rows: FriendLogRow[]) => void = () => {};
        vi.mocked(
            friendLogHistoryRepository.getFriendLogHistory
        ).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        act(() => result.current.loadOlder());
        rerender({ ...initial, searchQuery: 'Name 1' });
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        const searchRows = result.current.rows;
        await act(async () =>
            finish([{ ...data[0], rowId: 999, displayName: 'Stale' }])
        );
        expect(result.current.rows).toBe(searchRows);
        expect(result.current.loadingOlder).toBe(false);
    });
});
