import { useEffect, useMemo } from 'react';

import { useAppTable } from '@/components/data-table/appTable';
import { canExpandFeedRow, getFeedRowId } from '@/components/feed/feedRows';

import { useFeedColumns } from './components/FeedColumns';
import { sortFeedTableRows } from './feedTableRows';
import { resolveFeedPageSize as resolvePageSize } from './feedTableState';
import { useFeedFilters } from './useFeedFilters';
import { useFeedFriendActions } from './useFeedFriendActions';
import { useFeedPreviousInstancesDialog } from './useFeedPreviousInstancesDialog';
import { useFeedRows } from './useFeedRows';
import { useFeedTableMeta } from './useFeedTableMeta';
import { useFeedTableState } from './useFeedTableState';

const EMPTY_SORT_META = { knownUsersById: {}, friendLogNamesById: {} };

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
    const { pagination, setPagination, sorting } = tableModel;
    const { knownUsersById, friendLogNamesById } = sorting.some(
        ({ id }) => id === 'displayName'
    )
        ? feedTableMeta
        : EMPTY_SORT_META;
    const sortedRows = useMemo(
        () =>
            sortFeedTableRows(feedRows.rows, sorting, {
                knownUsersById,
                friendLogNamesById
            }),
        [feedRows.rows, sorting, knownUsersById, friendLogNamesById]
    );
    const pageRows = useMemo(() => {
        const start = pagination.pageIndex * pagination.pageSize;
        return sortedRows.slice(start, start + pagination.pageSize);
    }, [sortedRows, pagination.pageIndex, pagination.pageSize]);

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
        data: pageRows,
        columns,
        manualPagination: true,
        manualSorting: true,
        rowCount: feedRows.rows.length,
        state: {
            columnSizing: tableModel.columnSizing,
            expanded: tableModel.expanded,
            sorting: tableModel.sorting,
            pagination: tableModel.pagination
        },
        onColumnSizingChange: tableModel.setColumnSizing,
        onExpandedChange: tableModel.setExpanded,
        onSortingChange: tableModel.setSorting,
        onPaginationChange: tableModel.setPagination,
        autoResetExpanded: false,
        autoResetPageIndex: false,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        getRowId: (row) => getFeedRowId(row),
        getRowCanExpand: (row) => canExpandFeedRow(row.original),
        meta: {
            feed: feedTableMeta
        }
    });

    return {
        filters,
        friendLogNamesById: feedRows.friendLogNamesById,
        hasMore: feedRows.hasMore,
        hasUnloadedLatest: feedRows.hasUnloadedLatest,
        friendActions,
        isFavoritesLoaded: feedRows.isFavoritesLoaded,
        listRows: sortedRows,
        loadOlder: feedRows.loadOlder,
        loadStatus: feedRows.loadStatus,
        loadingOlder: feedRows.loadingOlder,
        normalQueryKey: feedRows.normalQueryKey,
        previousInstancesDialog,
        resolvePageSize,
        rows: feedRows.rows,
        reloadLatest: feedRows.reloadLatest,
        searchMode: feedRows.searchMode,
        setViewingLatest: feedRows.setViewingLatest,
        table,
        tableModel
    };
}
