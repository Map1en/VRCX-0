import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useMemo } from 'react';

import { useModerationColumns } from './components/ModerationColumns';
import { matchesModerationSearch } from './moderationPageState';
import { useModerationFilters } from './useModerationFilters';
import { useModerationRowActions } from './useModerationRowActions';
import { useModerationRows } from './useModerationRows';
import { useModerationShiftKey } from './useModerationShiftKey';
import { useModerationTableState } from './useModerationTableState';

type ModerationPageControllerOptions = {
    refreshKey?: string;
};

export function useModerationPageController({
    refreshKey = ''
}: ModerationPageControllerOptions = {}) {
    const filters = useModerationFilters();
    const rowsState = useModerationRows({ refreshKey });
    const filteredRows = useMemo(() => {
        const activeTypeSet = filters.selectedTypes.length
            ? new Set(filters.selectedTypes)
            : null;
        return rowsState.rows.filter((row: any) => {
            if (activeTypeSet && !activeTypeSet.has(row?.type)) {
                return false;
            }
            return matchesModerationSearch(row, filters.searchQuery);
        });
    }, [filters.searchQuery, filters.selectedTypes, rowsState.rows]);
    const tableState = useModerationTableState({
        filteredRowsLength: filteredRows.length,
        searchQuery: filters.searchQuery,
        selectedTypes: filters.selectedTypes
    });
    const shiftHeld = useModerationShiftKey();
    const actions = useModerationRowActions({
        rows: rowsState.rows,
        setDetail: rowsState.setDetail,
        setRows: rowsState.setRows
    });
    const columns = useModerationColumns({
        deletingModerationKey: actions.deletingModerationKey,
        onDeleteModeration: actions.handleDeleteModeration,
        onOpenUser: actions.openModerationUser,
        shiftHeld
    });
    const table = useReactTable({
        data: filteredRows,
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

    return {
        filteredRows,
        filters,
        rowsState,
        table,
        tableState
    };
}
