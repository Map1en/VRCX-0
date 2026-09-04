import { useEffect, useMemo, useRef } from 'react';

import { useAppTable } from '@/components/data-table/appTable';
import { sortTableRowsByDateAndType } from '@/components/data-table/sortRowsByDateAndType';
import { useFriendLogStore } from '@/state/friendLogStore';

import { useFriendLogColumns } from './components/FriendLogColumns';
import { getFriendLogRowKey } from './friendLogRows';
import { useFriendLogFilters } from './useFriendLogFilters';
import { useFriendLogRowActions } from './useFriendLogRowActions';
import { useFriendLogRows } from './useFriendLogRows';
import { useFriendLogShiftKey } from './useFriendLogShiftKey';
import { useFriendLogTableState } from './useFriendLogTableState';

export function useFriendLogPageController() {
    const filters = useFriendLogFilters();

    const friendLogRevision = useFriendLogStore((state) => state.revision);
    const refreshFriendLogRef = useRef(filters.refreshFriendLog);
    refreshFriendLogRef.current = filters.refreshFriendLog;
    const seenRevisionRef = useRef(friendLogRevision);
    useEffect(() => {
        if (seenRevisionRef.current === friendLogRevision) {
            return;
        }
        seenRevisionRef.current = friendLogRevision;
        refreshFriendLogRef.current();
    }, [friendLogRevision]);

    const rows = useFriendLogRows({
        refreshToken: filters.refreshToken,
        searchQuery: filters.searchQuery,
        selectedTypes: filters.selectedTypes
    });
    const tableState = useFriendLogTableState({
        hideUnfriends: rows.hideUnfriends,
        orderedRowsLength: rows.orderedRows.length,
        searchQuery: filters.searchQuery,
        selectedTypes: filters.selectedTypes
    });
    const shiftHeld = useFriendLogShiftKey();
    const rowActions = useFriendLogRowActions({
        currentUserId: rows.currentUserId,
        loadStatus: rows.loadStatus,
        rowsOwnerUserId: rows.rowsOwnerUserId,
        rowsOwnerUserIdRef: rows.rowsOwnerUserIdRef,
        setDetail: rows.setDetail,
        setRows: rows.setRows
    });
    const columns = useFriendLogColumns({
        currentUserId: rows.currentUserId,
        deletingRowKey: rowActions.deletingRowKey,
        handleDeleteRow: rowActions.handleDeleteRow,
        loadStatus: rows.loadStatus,
        rowsOwnerUserId: rows.rowsOwnerUserId,
        shiftHeld
    });
    const sortedRows = useMemo(
        () => sortTableRowsByDateAndType(rows.orderedRows, tableState.sorting),
        [rows.orderedRows, tableState.sorting]
    );
    const { resolveDisplayName } = rows;
    const { pageIndex, pageSize } = tableState.pagination;
    const pageRows = useMemo(() => {
        const start = pageIndex * pageSize;
        return sortedRows.slice(start, start + pageSize).map((row) => ({
            ...row,
            resolvedDisplayName: resolveDisplayName(row)
        }));
    }, [sortedRows, pageIndex, pageSize, resolveDisplayName]);
    const table = useAppTable({
        data: pageRows,
        columns,
        state: {
            columnOrder: tableState.columnOrder,
            columnSizing: tableState.columnSizing,
            columnVisibility: tableState.columnVisibility,
            sorting: tableState.sorting,
            pagination: tableState.pagination
        },
        onSortingChange: tableState.setSorting,
        onPaginationChange: tableState.setPagination,
        onColumnVisibilityChange: tableState.setColumnVisibility,
        onColumnOrderChange: tableState.setColumnOrder,
        onColumnSizingChange: tableState.setColumnSizing,
        getRowId: (row) => getFriendLogRowKey(row, rows.rowsOwnerUserId),
        manualPagination: true,
        manualSorting: true,
        rowCount: rows.orderedRows.length,
        autoResetPageIndex: false,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked: tableState.columnOrderLocked,
            setColumnOrderLocked: tableState.setColumnOrderLocked
        }
    });
    const isLoading = rows.loadStatus === 'running' && rows.rows.length === 0;
    const isError = rows.loadStatus === 'error' && rows.rows.length === 0;

    return {
        filters,
        isError,
        isLoading,
        rows,
        table,
        tableState
    };
}
