import { useEffect } from 'react';

import { useAppTable } from '@/components/data-table/appTable';
import { canExpandFeedRow, getFeedRowId } from '@/components/feed/feedRows';

import { useFeedColumns } from './components/FeedColumns';
import { resolveFeedPageSize as resolvePageSize } from './feedTableState';
import { useFeedFilters } from './useFeedFilters';
import { useFeedFriendActions } from './useFeedFriendActions';
import { useFeedPreviousInstancesDialog } from './useFeedPreviousInstancesDialog';
import { useFeedRows } from './useFeedRows';
import { useFeedTableMeta } from './useFeedTableMeta';
import { useFeedTableState } from './useFeedTableState';

export function useFeedPageController({
    routeScopedUserIds
}: {
    routeScopedUserIds: readonly string[];
}) {
    const filters = useFeedFilters({ routeScopedUserIds });
    const tableModel = useFeedTableState({
        activeFilters: filters.activeFilters,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        deferredSearchQuery: filters.deferredSearchQuery,
        favoritesOnly: filters.favoritesOnly,
        scopedUserIds: filters.deferredScopedUserIds,
        setFavoritesOnly: filters.setFavoritesOnly,
        setFeedFilters: filters.setFeedFilters
    });
    const feedRows = useFeedRows({
        activeFilters: filters.activeFilters,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        deferredSearchQuery: filters.deferredSearchQuery,
        favoritesOnly: filters.favoritesOnly,
        scopedUserIds: filters.deferredScopedUserIds,
        preferencesReady: tableModel.preferencesReady
    });
    const previousInstancesDialog = useFeedPreviousInstancesDialog();
    const friendActions = useFeedFriendActions();
    const feedTableMeta = useFeedTableMeta({
        actions: friendActions,
        friendLogNamesById: feedRows.friendLogNamesById,
        loadingPreviousInstancesKey: previousInstancesDialog.loadingKey,
        onOpenPreviousInstances:
            previousInstancesDialog.openPreviousInstancesForLocation,
        rows: feedRows.rows
    });
    const columns = useFeedColumns(feedTableMeta);
    const { pagination, setPagination } = tableModel;

    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(feedRows.rows.length / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [
        feedRows.rows.length,
        pagination.pageIndex,
        pagination.pageSize,
        setPagination
    ]);

    const table = useAppTable({
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
        autoResetExpanded: false,
        autoResetPageIndex: false,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        getRowId: (row) => getFeedRowId(row),
        getRowCanExpand: (row) => canExpandFeedRow(row.original),
        meta: {
            columnOrderLocked: tableModel.columnOrderLocked,
            setColumnOrderLocked: tableModel.setColumnOrderLocked,
            feed: feedTableMeta
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
