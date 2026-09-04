import { useEffect, useMemo } from 'react';

import { useAppTable } from '@/components/data-table/appTable';
import { sortTableRowsByDateAndType } from '@/components/data-table/sortRowsByDateAndType';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useGameLogColumns } from './components/GameLogColumns';
import { useGameLogAnnotations } from './useGameLogAnnotations';
import { useGameLogFilters } from './useGameLogFilters';
import { useGameLogPreviousInstancesDialog } from './useGameLogPreviousInstancesDialog';
import { useGameLogRowActions } from './useGameLogRowActions';
import { useGameLogRows } from './useGameLogRows';
import { useGameLogShiftKey } from './useGameLogShiftKey';
import { useGameLogTableState } from './useGameLogTableState';

export function useGameLogPageController() {
    const filters = useGameLogFilters();
    const tableState = useGameLogTableState({
        deferredSearchQuery: filters.deferredSearchQuery,
        sessionDateFrom: filters.sessionDateFrom,
        sessionDateTo: filters.sessionDateTo,
        sessionFavoritesOnly: filters.sessionFavoritesOnly,
        sessionSelectedTypes: filters.sessionSelectedTypes,
        tableFavoritesOnly: filters.tableFavoritesOnly,
        tableSelectedTypes: filters.tableSelectedTypes,
        viewMode: filters.viewMode
    });
    const rowsState = useGameLogRows({
        deferredSearchQuery: filters.deferredSearchQuery,
        favoritesOnly: filters.favoritesOnly,
        filters: filters.queryFilterTypes,
        preferencesReady:
            filters.preferencesReady && tableState.preferencesReady,
        refreshToken: filters.refreshToken,
        sessionDateFrom: filters.sessionDateFrom,
        sessionDateTo: filters.sessionDateTo,
        sessionLimit: tableState.sessionLimit,
        viewMode: filters.viewMode
    });
    const { pagination, setPagination, sorting } = tableState;
    const sortedRows = useMemo(
        () => sortTableRowsByDateAndType(rowsState.rows, sorting),
        [rowsState.rows, sorting]
    );
    const pageRows = useMemo(() => {
        const start = pagination.pageIndex * pagination.pageSize;
        return sortedRows.slice(start, start + pagination.pageSize);
    }, [sortedRows, pagination.pageIndex, pagination.pageSize]);
    const annotations = useGameLogAnnotations({
        rows: pageRows
    });
    const rowActions = useGameLogRowActions({
        removeRowByKey: rowsState.removeRowByKey
    });
    const previousInstancesDialog = useGameLogPreviousInstancesDialog();
    const shiftHeld = useGameLogShiftKey();
    const columns = useGameLogColumns({
        deletingGameLogKey: rowActions.deletingGameLogKey,
        loadingPreviousInstancesKey: previousInstancesDialog.loadingKey,
        onCopyDetail: rowActions.copyGameLogDetail,
        onDeleteRow: rowActions.deleteGameLogRow,
        onOpenPreviousInstances:
            previousInstancesDialog.openPreviousInstancesForRow,
        shiftHeld
    });
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning === true
    );
    const table = useAppTable({
        data: annotations.annotatedRows,
        columns,
        manualPagination: true,
        manualSorting: true,
        rowCount: rowsState.rows.length,
        getRowId: (row) => `${row.type}:${row.rowId}`,
        state: {
            columnOrder: tableState.columnOrder,
            columnSizing: tableState.columnSizing,
            columnVisibility: tableState.columnVisibility,
            pagination: tableState.pagination,
            sorting: tableState.sorting
        },
        onSortingChange: tableState.setSorting,
        onPaginationChange: tableState.setPagination,
        onColumnVisibilityChange: tableState.setColumnVisibility,
        onColumnOrderChange: tableState.setColumnOrder,
        onColumnSizingChange: tableState.setColumnSizing,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked: tableState.columnOrderLocked,
            setColumnOrderLocked: tableState.setColumnOrderLocked
        }
    });

    useEffect(() => {
        setPagination((current) =>
            current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }
        );
    }, [rowsState.rows, sorting, annotations.affinity, setPagination]);

    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(rowsState.rows.length / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) =>
                current.pageIndex > maxPageIndex
                    ? { ...current, pageIndex: maxPageIndex }
                    : current
            );
        }
    }, [
        rowsState.rows.length,
        pagination.pageIndex,
        pagination.pageSize,
        setPagination
    ]);

    const pageCount = Math.max(1, table.getPageCount());
    const isLoading =
        rowsState.loadStatus === 'running' &&
        (filters.viewMode === 'sessions'
            ? rowsState.sessions.length === 0
            : rowsState.rows.length === 0);
    const isLoadingMoreSessions =
        rowsState.loadStatus === 'running' &&
        filters.viewMode === 'sessions' &&
        rowsState.sessions.length > 0;
    const hasMoreSessions =
        filters.viewMode === 'sessions' &&
        rowsState.sessions.length >= tableState.sessionLimit &&
        tableState.sessionLimit < 1000;
    const isError =
        rowsState.loadStatus === 'error' &&
        (filters.viewMode === 'sessions'
            ? rowsState.sessions.length === 0
            : rowsState.rows.length === 0);

    return {
        annotations,
        filters,
        isError,
        isGameRunning,
        isLoading,
        isLoadingMoreSessions,
        hasMoreSessions,
        pageCount,
        previousInstancesDialog,
        rowActions,
        rowsState,
        table,
        tableState
    };
}
