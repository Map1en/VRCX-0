import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useEffect } from 'react';

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
        paginationPageSize: tableState.pagination.pageSize,
        preferencesReady:
            filters.preferencesReady && tableState.preferencesReady,
        refreshToken: filters.refreshToken,
        sessionDateFrom: filters.sessionDateFrom,
        sessionDateTo: filters.sessionDateTo,
        sessionLimit: tableState.sessionLimit,
        viewMode: filters.viewMode
    });
    const annotations = useGameLogAnnotations({
        rows: rowsState.rows,
        sessions: rowsState.sessions
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
    const isGameRunning = useRuntimeStore((state: any) =>
        Boolean(state.gameState.isGameRunning)
    );
    const table = useReactTable({
        data: annotations.annotatedRows,
        columns,
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
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked: tableState.columnOrderLocked,
            setColumnOrderLocked: tableState.setColumnOrderLocked
        }
    });

    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(
                annotations.annotatedRows.length /
                    tableState.pagination.pageSize
            ) - 1
        );
        if (tableState.pagination.pageIndex > maxPageIndex) {
            tableState.setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [
        annotations.annotatedRows.length,
        tableState.pagination.pageIndex,
        tableState.pagination.pageSize,
        tableState.setPagination
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
