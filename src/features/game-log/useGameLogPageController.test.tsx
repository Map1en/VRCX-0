// @vitest-environment jsdom

import type { PaginationState, SortingState } from '@tanstack/react-table';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FavoriteGroupMap } from '@/domain/favorites/types';

import type {
    GameLogRow,
    GameLogSession,
    GameLogViewMode
} from './gameLogTypes';

const mocks = vi.hoisted(
    (): {
        rows: GameLogRow[];
        sessions: GameLogSession[];
        viewMode: GameLogViewMode;
        favorites: {
            favoriteFriendIds: string[];
            localFriendFavorites: FavoriteGroupMap;
        };
        friends: { friendsById: Record<string, object> };
    } => ({
        rows: [],
        sessions: [],
        viewMode: 'table',
        favorites: { favoriteFriendIds: [], localFriendFavorites: {} },
        friends: { friendsById: {} }
    })
);

vi.mock('./components/GameLogColumns', () => ({
    useGameLogColumns: () => [
        { accessorKey: 'created_at', id: 'created_at' },
        { accessorKey: 'type', id: 'type' }
    ]
}));

vi.mock('./useGameLogFilters', () => ({
    useGameLogFilters: () => ({
        deferredSearchQuery: '',
        favoritesOnly: false,
        preferencesReady: true,
        queryFilterTypes: [],
        refreshToken: 0,
        sessionDateFrom: '',
        sessionDateTo: '',
        sessionFavoritesOnly: false,
        sessionSelectedTypes: [],
        tableFavoritesOnly: false,
        tableSelectedTypes: [],
        viewMode: mocks.viewMode
    })
}));

vi.mock('./useGameLogRows', () => ({
    useGameLogRows: () => ({
        loadStatus: 'ready',
        rows: mocks.rows,
        sessions: mocks.sessions,
        removeRowByKey: vi.fn()
    })
}));

vi.mock('./useGameLogPreviousInstancesDialog', () => ({
    useGameLogPreviousInstancesDialog: () => ({
        loadingKey: '',
        openPreviousInstancesForRow: vi.fn()
    })
}));

vi.mock('./useGameLogRowActions', () => ({
    useGameLogRowActions: () => ({})
}));

vi.mock('./useGameLogShiftKey', () => ({
    useGameLogShiftKey: () => false
}));

vi.mock('./useGameLogTableState', () => ({
    useGameLogTableState: () => {
        const [pagination, setPagination] = useState<PaginationState>({
            pageIndex: 0,
            pageSize: 20
        });
        const [sorting, setSorting] = useState<SortingState>([
            { id: 'created_at', desc: true }
        ]);
        return {
            pagination,
            preferencesReady: true,
            sessionLimit: 20,
            setPagination,
            setSorting,
            sorting
        };
    }
}));

vi.mock('@/state/favoriteStore', () => ({
    useFavoriteStore: <T,>(selector: (state: typeof mocks.favorites) => T) =>
        selector(mocks.favorites)
}));

vi.mock('@/state/friendRosterStore', () => ({
    useFriendRosterStore: <T,>(selector: (state: typeof mocks.friends) => T) =>
        selector(mocks.friends)
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: { gameState: { isGameRunning: boolean } }) => T
    ) => selector({ gameState: { isGameRunning: false } })
}));

import { useGameLogPageController } from './useGameLogPageController';

function createRows(count: number): GameLogRow[] {
    return Array.from({ length: count }, (_, index) => ({
        rowId: index + 1,
        created_at: new Date(Date.UTC(2026, 7, 31, 0, index)).toISOString(),
        type: 'OnPlayerLeft',
        userId: `usr_${index + 1}`
    }));
}

describe('useGameLogPageController', () => {
    afterEach(cleanup);

    beforeEach(() => {
        mocks.rows = createRows(45);
        mocks.sessions = [];
        mocks.viewMode = 'table';
        mocks.favorites = { favoriteFriendIds: [], localFriendFavorites: {} };
        mocks.friends = { friendsById: {} };
    });

    it('only annotates and builds row models for the current page while retaining the full total', () => {
        const { result } = renderHook(useGameLogPageController);

        expect(result.current.rowsState.rows).toBe(mocks.rows);
        expect(result.current.table.getRowCount()).toBe(45);
        expect(result.current.pageCount).toBe(3);
        expect(result.current.annotations.annotatedRows).toHaveLength(20);
        expect(result.current.table.getCoreRowModel().rows).toHaveLength(20);
        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            45
        );
        result.current.table.getRowModel().rows[0].getVisibleCells();

        act(() => result.current.table.nextPage());

        expect(result.current.tableState.pagination.pageIndex).toBe(1);
        expect(result.current.table.getCoreRowModel().rows).toHaveLength(20);
        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            25
        );
        expect(
            result.current.table.getCoreRowModel().rowsById['OnPlayerLeft:45']
        ).toBeUndefined();

        act(() => result.current.table.lastPage());

        expect(result.current.annotations.annotatedRows).toHaveLength(5);
        expect(result.current.table.getCoreRowModel().rows).toHaveLength(5);
        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            5
        );
        expect(result.current.table.getCanNextPage()).toBe(false);
        expect(
            mocks.rows.every(
                (row) =>
                    row.isFavorite === undefined && row.isFriend === undefined
            )
        ).toBe(true);
    });

    it('keeps row and cell IDs independent of large log payloads', () => {
        const data = 'large log message '.repeat(10_000);
        mocks.rows = [{ rowId: 1, type: 'Event', created_at: '', data }];
        const { result, rerender } = renderHook(useGameLogPageController);
        const row = result.current.table.getRowModel().rows[0];

        expect(row.id).toBe('Event:1');
        expect(row.original.data).toBe(data);
        const cellIds = row.getVisibleCells().map((cell) => cell.id);
        expect(cellIds.every((id) => id.length < 50)).toBe(true);

        mocks.rows = [{ ...mocks.rows[0], data: 'updated log message' }];
        rerender();

        const updatedRow = result.current.table.getRowModel().rows[0];
        expect(updatedRow.id).toBe(row.id);
        expect(updatedRow.getVisibleCells().map((cell) => cell.id)).toEqual(
            cellIds
        );
    });

    it('sorts the full result before slicing and resets the page when sorting changes', () => {
        mocks.rows = mocks.rows.map((row, index) => ({
            ...row,
            type: index < 40 ? 'VideoPlay' : 'Location'
        }));
        const { result } = renderHook(useGameLogPageController);
        act(() => result.current.table.nextPage());
        act(() =>
            result.current.table.setSorting([{ id: 'type', desc: false }])
        );

        expect(result.current.tableState.pagination.pageIndex).toBe(0);
        expect(
            result.current.table
                .getRowModel()
                .rows.slice(0, 5)
                .map((row) => row.original.rowId)
        ).toEqual([41, 42, 43, 44, 45]);
        expect(result.current.table.getRowModel().rows[5].original.rowId).toBe(
            1
        );

        act(() => result.current.table.setSorting([]));

        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            1
        );
        expect(result.current.rowsState.rows).toBe(mocks.rows);
    });

    it('resets after refreshing or deleting rows and retains correct totals after resizing the page', () => {
        const { result, rerender } = renderHook(useGameLogPageController);
        act(() => result.current.table.lastPage());

        mocks.rows = createRows(25);
        rerender();

        expect(result.current.tableState.pagination.pageIndex).toBe(0);
        expect(result.current.table.getRowCount()).toBe(25);
        expect(result.current.pageCount).toBe(2);
        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            25
        );

        act(() =>
            result.current.tableState.setPagination({
                pageIndex: 0,
                pageSize: 10
            })
        );
        act(() => result.current.table.lastPage());

        expect(result.current.pageCount).toBe(3);
        expect(result.current.annotations.annotatedRows).toHaveLength(5);
        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            5
        );

        mocks.rows = [];
        rerender();

        expect(result.current.tableState.pagination.pageIndex).toBe(0);
        expect(result.current.table.getRowCount()).toBe(0);
        expect(result.current.table.getCoreRowModel().rows).toHaveLength(0);
    });

    it('updates remote favorites, local favorites, and friend markers without annotating source rows', () => {
        mocks.favorites.favoriteFriendIds = ['usr_45'];
        mocks.friends.friendsById = { usr_45: {} };
        const { result, rerender } = renderHook(useGameLogPageController);

        expect(result.current.annotations.annotatedRows[0]).toMatchObject({
            rowId: 45,
            isFavorite: true,
            isFriend: true
        });
        act(() => result.current.table.nextPage());

        mocks.favorites = {
            favoriteFriendIds: [],
            localFriendFavorites: { favorites: ['usr_25'] }
        };
        mocks.friends.friendsById = { usr_25: {} };
        rerender();

        expect(result.current.tableState.pagination.pageIndex).toBe(0);
        expect(result.current.annotations.annotatedRows[0]).toMatchObject({
            rowId: 45,
            isFavorite: false,
            isFriend: false
        });
        act(() => result.current.table.nextPage());

        expect(result.current.annotations.annotatedRows[0]).toMatchObject({
            rowId: 25,
            isFavorite: true,
            isFriend: true
        });
        expect(mocks.rows[24].isFavorite).toBeUndefined();
        expect(mocks.rows[24].isFriend).toBeUndefined();
    });

    it('keeps the original session tree and updates shared affinity when switching modes', () => {
        const { result, rerender } = renderHook(useGameLogPageController);
        act(() => result.current.table.lastPage());
        mocks.viewMode = 'sessions';
        mocks.rows = [];
        mocks.favorites.favoriteFriendIds = ['usr_1'];
        mocks.friends.friendsById = { usr_1: {} };
        mocks.sessions = [
            {
                created_at: '2026-08-31T00:00:00Z',
                location: 'wrld_test:1',
                worldId: 'wrld_test',
                worldName: 'World',
                groupName: '',
                duration: 1000,
                playerDurationRows: [
                    { userId: 'usr_1', displayName: 'User', time: 1000 }
                ],
                events: [
                    {
                        type: 'OnPlayerJoined',
                        created_at: '2026-08-31T00:00:00Z',
                        userId: 'usr_1'
                    }
                ]
            }
        ];
        rerender();

        expect(result.current.table.getCoreRowModel().rows).toHaveLength(0);
        expect(result.current.rowsState.sessions).toBe(mocks.sessions);
        expect(
            result.current.annotations.affinity.favoriteIdSet.has('usr_1')
        ).toBe(true);
        expect(
            result.current.annotations.affinity.friendIdSet.has('usr_1')
        ).toBe(true);
        expect(mocks.sessions[0].events[0]).not.toHaveProperty('isFriend');

        const affinity = result.current.annotations.affinity;
        rerender();
        expect(result.current.annotations.affinity).toBe(affinity);

        mocks.favorites.favoriteFriendIds = [];
        mocks.friends.friendsById = {};
        rerender();
        expect(result.current.rowsState.sessions).toBe(mocks.sessions);
        expect(result.current.annotations.affinity.favoriteIdSet.size).toBe(0);
        expect(result.current.annotations.affinity.friendIdSet.size).toBe(0);
        expect(mocks.sessions[0].events[0].isFavorite).toBeUndefined();
    });
});
