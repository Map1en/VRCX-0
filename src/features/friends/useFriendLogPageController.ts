import { useMemo } from 'react';

import { useAppTable } from '@/components/data-table/appTable';
import type { LogFilterCommands } from '@/components/data-table/LogFilterContextMenu';
import { sortTableRowsByDateAndType } from '@/components/data-table/sortRowsByDateAndType';
import { useShiftKeyHeld } from '@/components/keyboard/useShiftKeyHeld';
import { FRIEND_LOG_TYPES } from '@/domain/friends/friendLog';

import { useFriendLogColumns } from './components/FriendLogColumns';
import { getFriendLogRowKey } from './friendLogRows';
import { useFriendLogFilters } from './useFriendLogFilters';
import { useFriendLogRowActions } from './useFriendLogRowActions';
import { useFriendLogRows } from './useFriendLogRows';
import { useFriendLogTableState } from './useFriendLogTableState';

export function useFriendLogPageController() {
    const filters = useFriendLogFilters();

    const rows = useFriendLogRows({
        refreshToken: filters.refreshToken,
        searchQuery: filters.searchQuery,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        selectedTypes: filters.selectedTypes,
        targetUserId: filters.targetUser?.id
    });
    const { selectedTypes, setSelectedTypes, setTargetUser } = filters;
    const rowFilterCommands = useMemo<LogFilterCommands>(() => {
        const currentTypes = selectedTypes.length
            ? selectedTypes
            : FRIEND_LOG_TYPES;
        return {
            onlyUser: (userId, userName) =>
                setTargetUser({ id: userId, name: userName }),
            canFilterType: (type) =>
                FRIEND_LOG_TYPES.some(
                    (friendLogType) => friendLogType === type
                ),
            onlyType: (type) => setSelectedTypes([type]),
            canExcludeType: (type) =>
                currentTypes.some((current) => current !== type),
            excludeType: (type) =>
                setSelectedTypes(
                    currentTypes.filter((current) => current !== type)
                )
        };
    }, [selectedTypes, setSelectedTypes, setTargetUser]);
    const tableState = useFriendLogTableState({
        hideUnfriends: rows.hideUnfriends,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        orderedRowsLength: rows.orderedRows.length,
        searchQuery: filters.searchQuery,
        selectedTypes: filters.selectedTypes
    });
    const shiftHeld = useShiftKeyHeld();
    const rowActions = useFriendLogRowActions({
        currentUserId: rows.currentUserId,
        loadStatus: rows.loadStatus,
        rowsOwnerUserId: rows.rowsOwnerUserId,
        rowsOwnerUserIdRef: rows.rowsOwnerUserIdRef,
        setDetail: rows.setDetail,
        removeRow: rows.removeRow
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
        () =>
            rows.searchMode
                ? sortTableRowsByDateAndType(
                      rows.orderedRows,
                      tableState.sorting
                  )
                : rows.orderedRows,
        [rows.orderedRows, rows.searchMode, tableState.sorting]
    );
    const { resolveDisplayName } = rows;
    const { pageIndex, pageSize } = tableState.pagination;
    const pageRows = useMemo(() => {
        if (!rows.searchMode) return [];
        const start = pageIndex * pageSize;
        return sortedRows.slice(start, start + pageSize).map((row) => ({
            ...row,
            resolvedDisplayName: resolveDisplayName(row)
        }));
    }, [sortedRows, rows.searchMode, pageIndex, pageSize, resolveDisplayName]);
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
        enableSorting: rows.searchMode,
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
        rowFilterCommands,
        isError,
        isLoading,
        rows,
        rowActions,
        shiftHeld,
        table,
        tableState
    };
}
