import {
    getCoreRowModel,
    getExpandedRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useEffect } from 'react';

import { useFeedColumns } from './components/FeedColumns';
import { getFeedRowId } from './feedRows';
import { resolveFeedPageSize as resolvePageSize } from './feedTableState';
import { useFeedFilters } from './useFeedFilters';
import { useFeedFriendActions } from './useFeedFriendActions';
import { useFeedPreviousInstancesDialog } from './useFeedPreviousInstancesDialog';
import { useFeedRows } from './useFeedRows';
import { useFeedTableState } from './useFeedTableState';

export function useFeedPageController() {
    const filters = useFeedFilters();
    const tableModel = useFeedTableState({
        activeFilters: filters.activeFilters,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        deferredSearchQuery: filters.deferredSearchQuery,
        favoritesOnly: filters.favoritesOnly,
        setFavoritesOnly: filters.setFavoritesOnly,
        setFeedFilters: filters.setFeedFilters
    });
    const feedRows = useFeedRows({
        activeFilters: filters.activeFilters,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        deferredSearchQuery: filters.deferredSearchQuery,
        favoritesOnly: filters.favoritesOnly,
        preferencesReady: tableModel.preferencesReady
    });
    const previousInstancesDialog = useFeedPreviousInstancesDialog();
    const friendActions = useFeedFriendActions();
    const columns = useFeedColumns({
        actions: friendActions,
        friendLogNamesById: feedRows.friendLogNamesById,
        loadingPreviousInstancesKey: previousInstancesDialog.loadingKey,
        onOpenPreviousInstances:
            previousInstancesDialog.openPreviousInstancesForLocation,
        rows: feedRows.rows
    });

    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(feedRows.rows.length / tableModel.pagination.pageSize) - 1
        );
        if (tableModel.pagination.pageIndex > maxPageIndex) {
            tableModel.setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [
        feedRows.rows.length,
        tableModel.pagination.pageIndex,
        tableModel.pagination.pageSize,
        tableModel.setPagination
    ]);

    const table = useReactTable({
        data: feedRows.rows,
        columns,
        state: {
            expanded: tableModel.expanded,
            columnVisibility: tableModel.columnVisibility,
            columnOrder: tableModel.columnOrder,
            columnSizing: tableModel.columnSizing,
            sorting: tableModel.sorting,
            pagination: tableModel.pagination
        },
        onExpandedChange: tableModel.setExpanded,
        onColumnVisibilityChange: tableModel.setColumnVisibility,
        onColumnOrderChange: tableModel.setColumnOrder,
        onColumnSizingChange: tableModel.setColumnSizing,
        onSortingChange: tableModel.setSorting,
        onPaginationChange: tableModel.setPagination,
        autoResetPageIndex: false,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getRowId: (row) => getFeedRowId(row),
        getRowCanExpand: () => true,
        meta: {
            columnOrderLocked: tableModel.columnOrderLocked,
            setColumnOrderLocked: tableModel.setColumnOrderLocked
        }
    });

    return {
        columns,
        filters,
        friendActions,
        isFavoritesLoaded: feedRows.isFavoritesLoaded,
        loadStatus: feedRows.loadStatus,
        previousInstancesDialog,
        resolvePageSize,
        rows: feedRows.rows,
        table,
        tableModel
    };
}
