import type {
    ColumnDef,
    PaginationState,
    SortingState
} from '@tanstack/react-table';
import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
    sanitizeTableColumnOrder,
    sanitizeTableColumnSizing,
    sanitizeTableColumnVisibility,
    usePersistedDataTableLayout
} from '@/components/data-table/dataTablePersistence';
import { usePreferencesStore } from '@/state/preferencesStore';

const GROUP_MODERATION_DEFAULT_PAGE_SIZE = 25;
const GROUP_MODERATION_DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

function sanitizeSorting(
    value: unknown,
    columnIds: readonly string[]
): SortingState {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.reduce<SortingState>((result, entry) => {
        const id = (entry as { id?: unknown })?.id;
        const desc = (entry as { desc?: unknown })?.desc;
        if (
            typeof id === 'string' &&
            typeof desc === 'boolean' &&
            columnIds.includes(id)
        ) {
            result.push({ id, desc });
        }
        return result;
    }, []);
}

export function useGroupModerationTable<TData>({
    columnIds,
    columns,
    paged,
    rows,
    tableId
}: {
    columnIds: string[];
    columns: ColumnDef<TData>[];
    paged: boolean;
    rows: TData[];
    tableId: string;
}) {
    const tableLayout = usePersistedDataTableLayout({ tableId, columnIds });
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const preferredPageSize = usePreferencesStore(
        (state) => state.tablePageSize
    );
    const preferredPageSizes = usePreferencesStore(
        (state) => state.tablePageSizes
    );
    const hasWrittenLayoutRef = useRef(false);
    const appliedPreferredPageSizeRef = useRef(false);
    const [sorting, setSorting] = useState<SortingState>(() =>
        sanitizeSorting(tableLayout.persistedState.sorting, columnIds)
    );
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: GROUP_MODERATION_DEFAULT_PAGE_SIZE
    });

    const pageSizes = useMemo(() => {
        const options = Array.isArray(preferredPageSizes)
            ? preferredPageSizes.filter(
                  (value): value is number =>
                      typeof value === 'number' &&
                      Number.isFinite(value) &&
                      value > 0
              )
            : [];
        return options.length ? options : GROUP_MODERATION_DEFAULT_PAGE_SIZES;
    }, [preferredPageSizes]);

    useEffect(() => {
        if (
            !paged ||
            appliedPreferredPageSizeRef.current ||
            !preferencesHydrated
        ) {
            return;
        }
        appliedPreferredPageSizeRef.current = true;
        if (preferredPageSize > 0) {
            setPagination((current) =>
                current.pageSize === preferredPageSize
                    ? current
                    : { ...current, pageSize: preferredPageSize }
            );
        }
    }, [paged, preferencesHydrated, preferredPageSize]);

    useEffect(() => {
        if (!hasWrittenLayoutRef.current) {
            hasWrittenLayoutRef.current = true;
            return;
        }
        tableLayout.writePersistedState({
            columnOrder: sanitizeTableColumnOrder(
                tableLayout.columnOrder,
                columnIds
            ),
            columnSizing: sanitizeTableColumnSizing(
                tableLayout.columnSizing,
                columnIds
            ),
            columnVisibility: sanitizeTableColumnVisibility(
                tableLayout.columnVisibility,
                columnIds
            ),
            sorting: sanitizeSorting(sorting, columnIds)
        });
    }, [
        columnIds,
        sorting,
        tableLayout.columnOrder,
        tableLayout.columnSizing,
        tableLayout.columnVisibility,
        tableLayout.writePersistedState
    ]);

    useEffect(() => {
        if (!paged) {
            return;
        }
        const maxPageIndex = Math.max(
            0,
            Math.ceil(rows.length / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [paged, pagination.pageIndex, pagination.pageSize, rows.length]);

    const table = useReactTable<TData>({
        columns,
        data: rows,
        state: {
            columnOrder: tableLayout.columnOrder,
            columnSizing: tableLayout.columnSizing,
            columnVisibility: tableLayout.columnVisibility,
            ...(paged ? { sorting, pagination } : {})
        },
        onColumnOrderChange: tableLayout.setColumnOrder,
        onColumnSizingChange: tableLayout.setColumnSizing,
        onColumnVisibilityChange: tableLayout.setColumnVisibility,
        onSortingChange: paged ? setSorting : undefined,
        onPaginationChange: paged ? setPagination : undefined,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: paged ? getSortedRowModel() : undefined,
        getPaginationRowModel: paged ? getPaginationRowModel() : undefined,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked: tableLayout.columnOrderLocked,
            setColumnOrderLocked: tableLayout.setColumnOrderLocked
        }
    });

    return { pageSizes, pagination, setPagination, table };
}
