import { useMemo } from 'react';

import { useAppTable } from '@/components/data-table/appTable';

import { useModerationColumns } from './components/ModerationColumns';
import {
    getModerationRowKey,
    matchesModerationSearch
} from './moderationPageState';
import type { ModerationRow } from './moderationPageTypes';
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
        return rowsState.rows.filter((row) => {
            if (activeTypeSet && !activeTypeSet.has(row.type)) {
                return false;
            }
            return matchesModerationSearch(row, filters.searchQuery);
        });
    }, [filters.searchQuery, filters.selectedTypes, rowsState.rows]);
    const tableState = useModerationTableState();
    const shiftHeld = useModerationShiftKey();
    const actions = useModerationRowActions({
        setDetail: rowsState.setDetail,
        setRows: rowsState.setRows
    });
    const columns = useModerationColumns({
        deletingModerationKey: actions.deletingModerationKey,
        onDeleteModeration: actions.handleDeleteModeration,
        onOpenUser: actions.openModerationUser,
        shiftHeld
    });
    const table = useAppTable<ModerationRow>({
        data: filteredRows,
        columns,
        state: {
            columnOrder: tableState.columnOrder,
            columnSizing: tableState.columnSizing,
            columnVisibility: tableState.columnVisibility,
            sorting: tableState.sorting
        },
        onSortingChange: tableState.setSorting,
        onColumnVisibilityChange: tableState.setColumnVisibility,
        onColumnOrderChange: tableState.setColumnOrder,
        onColumnSizingChange: tableState.setColumnSizing,
        getRowId: getModerationRowKey,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked: tableState.columnOrderLocked,
            setColumnOrderLocked: tableState.setColumnOrderLocked
        }
    });
    const listResetKey = [
        filters.searchQuery,
        filters.selectedTypes.join(','),
        tableState.sorting.map((entry) => `${entry.id}:${entry.desc}`).join(',')
    ].join('|');

    return {
        filters,
        listResetKey,
        rowsState,
        table
    };
}
