// @vitest-environment jsdom

import type {
    ColumnSizingState,
    ExpandedState,
    PaginationState,
    SortingState
} from '@tanstack/react-table';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedRow, FeedTableMeta } from '@/components/feed/feedTypes';

const mocks = vi.hoisted(
    (): {
        rows: FeedRow[];
        searchMode: boolean;
        meta: Pick<FeedTableMeta, 'knownUsersById' | 'friendLogNamesById'>;
    } => ({
        rows: [],
        searchMode: true,
        meta: { knownUsersById: {}, friendLogNamesById: {} }
    })
);

vi.mock('./components/FeedColumns', () => ({
    useFeedColumns: () => [
        {
            accessorKey: 'type',
            id: 'type'
        },
        {
            accessorKey: 'created_at',
            id: 'created_at'
        },
        {
            accessorKey: 'displayName',
            id: 'displayName'
        }
    ]
}));

vi.mock('./useFeedFilters', () => ({
    useFeedFilters: () => ({
        activeFilters: [],
        dateFrom: '',
        dateTo: '',
        deferredSearchQuery: '',
        deferredScopedUserIds: [],
        favoritesOnly: false,
        setFavoritesOnly: vi.fn(),
        setFeedFilters: vi.fn()
    })
}));

vi.mock('./useFeedFriendActions', () => ({
    useFeedFriendActions: () => ({})
}));

vi.mock('./useFeedPreviousInstancesDialog', () => ({
    useFeedPreviousInstancesDialog: () => ({
        loadingKey: '',
        openPreviousInstancesForLocation: vi.fn()
    })
}));

vi.mock('./useFeedRows', () => ({
    useFeedRows: () => ({
        friendLogNamesById: {},
        hasMore: false,
        hasUnloadedLatest: false,
        isFavoritesLoaded: true,
        loadOlder: vi.fn(),
        loadStatus: 'ready',
        loadingOlder: false,
        normalQueryKey: 'normal',
        reloadLatest: vi.fn(),
        searchMode: mocks.searchMode,
        setViewingLatest: vi.fn(),
        rows: mocks.rows
    })
}));

vi.mock('./useFeedTableMeta', () => ({
    useFeedTableMeta: () => mocks.meta
}));

vi.mock('./useFeedTableState', () => ({
    useFeedTableState: () => {
        const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
        const [expanded, setExpanded] = useState<ExpandedState>({});
        const [pagination, setPagination] = useState<PaginationState>({
            pageIndex: 0,
            pageSize: 20
        });
        const [sorting, setSorting] = useState<SortingState>([]);

        return {
            columnSizing,
            expanded,
            pageSizes: [20],
            pagination,
            preferencesReady: true,
            setColumnSizing,
            setExpanded,
            setPagination,
            setSorting,
            sorting
        };
    }
}));

import { getFeedRowId } from '@/components/feed/feedRows';

import { useFeedPageController } from './useFeedPageController';

describe('useFeedPageController', () => {
    beforeEach(() => {
        mocks.rows = [];
        mocks.searchMode = true;
        mocks.meta = { knownUsersById: {}, friendLogNamesById: {} };
    });

    it.each(['created_at', 'type'])(
        'does not rebuild the %s-sorted page when user facts change',
        (id) => {
            mocks.rows = [
                {
                    rowId: 1,
                    type: 'Status',
                    created_at: '2026-08-31T00:00:00Z'
                },
                { rowId: 2, type: 'GPS', created_at: '2026-08-30T00:00:00Z' }
            ];
            const { result, rerender } = renderHook(() =>
                useFeedPageController({ routeScopedUserIds: [] })
            );
            act(() => result.current.table.setSorting([{ id, desc: false }]));
            const rowModel = result.current.table.getCoreRowModel();

            mocks.meta.knownUsersById = {
                usr_1: {
                    id: 'usr_1',
                    endpoint: 'default',
                    updatedAt: '',
                    displayName: 'Alice'
                }
            };
            mocks.meta.friendLogNamesById = { usr_1: 'Alice' };
            rerender();

            expect(result.current.table.getCoreRowModel()).toBe(rowModel);
        }
    );

    it('updates name sorting when a fallback display name changes', () => {
        mocks.rows = [
            { rowId: 1, userId: 'usr_1' },
            { rowId: 2, userId: 'usr_2' }
        ];
        mocks.meta.friendLogNamesById = { usr_1: 'Alice', usr_2: 'Bob' };
        const { result, rerender } = renderHook(() =>
            useFeedPageController({ routeScopedUserIds: [] })
        );
        act(() => {
            result.current.table.setSorting([
                { id: 'displayName', desc: false }
            ]);
        });
        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            1
        );

        mocks.meta.friendLogNamesById = { usr_1: 'Zoe', usr_2: 'Bob' };
        rerender();

        expect(result.current.table.getRowModel().rows[0].original.rowId).toBe(
            2
        );
    });

    it('only builds row models for the current page while retaining the total', () => {
        mocks.rows = Array.from({ length: 45 }, (_, index) => ({
            rowId: index + 1,
            type: 'GPS'
        }));
        const { result } = renderHook(() =>
            useFeedPageController({ routeScopedUserIds: [] })
        );

        expect(result.current.rows).toBe(mocks.rows);
        expect(result.current.table.getRowCount()).toBe(45);
        expect(result.current.table.getPageCount()).toBe(3);
        expect(result.current.table.getCoreRowModel().rows).toHaveLength(20);
        expect(result.current.table.getRowModel().rows[0].original).toBe(
            mocks.rows[0]
        );

        act(() => result.current.table.nextPage());

        expect(result.current.table.getCoreRowModel().rows).toHaveLength(20);
        expect(result.current.table.getRowModel().rows[0].original).toBe(
            mocks.rows[20]
        );
        expect(
            result.current.table.getCoreRowModel().rowsById[
                getFeedRowId(mocks.rows[0])
            ]
        ).toBeUndefined();

        act(() => result.current.table.lastPage());

        expect(result.current.table.getCoreRowModel().rows).toHaveLength(5);
        expect(result.current.table.getRowModel().rows[0].original).toBe(
            mocks.rows[40]
        );
        expect(result.current.table.getCanNextPage()).toBe(false);
        expect(result.current.table.getCanPreviousPage()).toBe(true);
    });

    it('sorts the complete result before slicing pages and restores query order', () => {
        mocks.rows = Array.from({ length: 45 }, (_, index) => ({
            rowId: index + 1,
            type: 'GPS',
            created_at: new Date(
                Date.UTC(2026, 7, 31, 0, 45 - index)
            ).toISOString()
        }));
        const { result } = renderHook(() =>
            useFeedPageController({ routeScopedUserIds: [] })
        );

        act(() => {
            result.current.table.setSorting([
                { id: 'created_at', desc: false }
            ]);
        });

        expect(
            result.current.table
                .getRowModel()
                .rows.map((row) => row.original.rowId)
        ).toEqual(Array.from({ length: 20 }, (_, index) => 45 - index));
        expect(result.current.listRows.map((row) => row.rowId)).toEqual(
            Array.from({ length: 45 }, (_, index) => 45 - index)
        );

        act(() => result.current.table.nextPage());

        expect(
            result.current.table
                .getRowModel()
                .rows.map((row) => row.original.rowId)
        ).toEqual(Array.from({ length: 20 }, (_, index) => 25 - index));
        expect(result.current.table.getCoreRowModel().rows).toHaveLength(20);

        act(() => result.current.table.setSorting([]));

        expect(result.current.table.getRowModel().rows[0].original).toBe(
            mocks.rows[20]
        );
    });

    it('keeps expansion when a row leaves the current page and returns', () => {
        mocks.rows = Array.from({ length: 25 }, (_, index) => ({
            rowId: index + 1,
            type: 'GPS',
            previousLocation: 'private'
        }));
        const rowId = getFeedRowId(mocks.rows[0]);
        const { result } = renderHook(() =>
            useFeedPageController({ routeScopedUserIds: [] })
        );

        act(() => result.current.table.getRow(rowId).toggleExpanded(true));
        act(() => result.current.table.nextPage());
        expect(result.current.table.getRowModel().rows).toHaveLength(5);
        act(() => result.current.table.previousPage());

        expect(result.current.table.getRow(rowId).getIsExpanded()).toBe(true);
    });

    it('clamps the page after the result shrinks and supports page size changes', () => {
        mocks.rows = Array.from({ length: 45 }, (_, index) => ({
            rowId: index + 1,
            type: 'GPS'
        }));
        const { result, rerender } = renderHook(() =>
            useFeedPageController({ routeScopedUserIds: [] })
        );
        act(() => result.current.table.lastPage());
        mocks.rows = mocks.rows.slice(0, 12);
        rerender();

        expect(result.current.tableModel.pagination.pageIndex).toBe(0);
        expect(result.current.table.getRowModel().rows).toHaveLength(12);
        expect(result.current.table.getPageCount()).toBe(1);

        act(() => result.current.table.setPageSize(5));

        expect(result.current.table.getCoreRowModel().rows).toHaveLength(5);
        expect(result.current.table.getPageCount()).toBe(3);
    });

    it('keeps a row expanded when refreshed data retains its id', async () => {
        const row: FeedRow = {
            rowId: 1,
            sourceRank: 60,
            type: 'GPS',
            previousLocation: 'private'
        };
        const rowId = getFeedRowId(row);
        mocks.rows = [row];
        const { result, rerender } = renderHook(() =>
            useFeedPageController({ routeScopedUserIds: [] })
        );

        act(() => {
            result.current.table.getRow(rowId).toggleExpanded(true);
        });
        expect(result.current.table.getRow(rowId).getIsExpanded()).toBe(true);

        mocks.rows = [{ ...row, worldName: 'Refreshed World' }];
        rerender();
        act(() => {
            result.current.table.getRowModel();
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current.table.getRow(rowId).getIsExpanded()).toBe(true);
    });
});
