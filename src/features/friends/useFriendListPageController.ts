import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useState } from 'react';

import { usePreferencesStore } from '@/state/preferencesStore';

import { useFriendListColumns } from './components/FriendListColumns';
import { useFriendListFilters } from './useFriendListFilters';
import { useFriendListRowActions } from './useFriendListRowActions';
import { useFriendListRows } from './useFriendListRows';
import { useFriendListSelection } from './useFriendListSelection';
import { useFriendListTableState } from './useFriendListTableState';

export function useFriendListPageController() {
    const filters = useFriendListFilters();
    const rows = useFriendListRows({
        activeSearchFilterIds: filters.activeSearchFilterIds,
        favoritesOnly: filters.favoritesOnly,
        searchQuery: filters.searchQuery
    });
    const tableState = useFriendListTableState({
        activeSearchFilterIds: filters.activeSearchFilterIds,
        favoritesOnly: filters.favoritesOnly,
        filteredRowsLength: rows.filteredRows.length,
        searchQuery: filters.searchQuery
    });
    const selection = useFriendListSelection({
        filteredRows: rows.filteredRows
    });
    const [mutualProgress, setMutualProgress] = useState({
        current: 0,
        total: 0
    });
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );
    const actions = useFriendListRowActions({
        filteredRows: rows.filteredRows,
        resetTableLayout: tableState.resetTableLayout,
        rosterRows: rows.rosterRows,
        selectedFriendIds: selection.selectedFriendIds,
        setDeletingFriendIds: selection.setDeletingFriendIds,
        setIsBulkDeleting: selection.setIsBulkDeleting,
        setMutualProgress,
        setSelectedFriendIds: selection.setSelectedFriendIds
    });
    const columns = useFriendListColumns({
        bulkUnfriendMode: selection.bulkUnfriendMode,
        currentUserId: rows.currentUserId,
        deletingFriendIds: selection.deletingFriendIds,
        onConfirmDeleteFriend: actions.confirmDeleteFriend,
        onToggleSelectedFriend: actions.toggleSelectedFriend,
        randomUserColours,
        selectedFriendIds: selection.selectedFriendIds
    });
    const table = useReactTable({
        data: rows.filteredRows,
        columns,
        state: {
            columnOrder: tableState.columnOrder,
            columnSizing: tableState.columnSizing,
            columnVisibility: {
                ...tableState.columnVisibility,
                friendNumber: true,
                bulkSelect: selection.bulkUnfriendMode
            },
            sorting: tableState.sorting,
            pagination: tableState.pagination
        },
        onSortingChange: tableState.setSorting,
        onPaginationChange: tableState.setPagination,
        onColumnVisibilityChange: tableState.setColumnVisibility,
        onColumnOrderChange: tableState.setColumnOrder,
        onColumnSizingChange: tableState.setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        autoResetPageIndex: false,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked: tableState.columnOrderLocked,
            setColumnOrderLocked: tableState.setColumnOrderLocked
        }
    });
    const pageCount = Math.max(1, table.getPageCount());
    const isLoading =
        rows.friendLoadStatus === 'running' && rows.rosterRows.length === 0;
    const isError =
        rows.friendLoadStatus === 'error' && rows.rosterRows.length === 0;
    const isMutualOptOut = Boolean(
        rows.currentUserSnapshot?.hasSharedConnectionsOptOut
    );

    return {
        actions,
        filters,
        isError,
        isLoading,
        isMutualOptOut,
        mutualProgress,
        pageCount,
        rows,
        selection,
        table,
        tableState
    };
}
