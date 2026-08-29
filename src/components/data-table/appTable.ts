import type {
    Cell,
    CellContext,
    Column,
    ColumnDef,
    ColumnVisibilityState,
    Header,
    ReactTable,
    Row,
    RowData,
    Table,
    TableOptions
} from '@tanstack/react-table';
import {
    columnOrderingFeature,
    columnResizingFeature,
    columnSizingFeature,
    columnVisibilityFeature,
    createExpandedRowModel,
    createPaginatedRowModel,
    createSortedRowModel,
    rowExpandingFeature,
    rowPaginationFeature,
    rowSortingFeature,
    tableFeatures,
    useTable
} from '@tanstack/react-table';
import { useMemo } from 'react';

const appTableFeatures = tableFeatures({
    rowSortingFeature,
    rowPaginationFeature,
    rowExpandingFeature,
    columnOrderingFeature,
    columnVisibilityFeature,
    columnSizingFeature,
    columnResizingFeature,
    sortedRowModel: createSortedRowModel(),
    paginatedRowModel: createPaginatedRowModel(),
    expandedRowModel: createExpandedRowModel()
});

type AppTableFeatures = typeof appTableFeatures;

export type AppColumnDef<TData extends RowData, TValue = unknown> = ColumnDef<
    AppTableFeatures,
    TData,
    TValue
>;
export type AppColumn<TData extends RowData, TValue = unknown> = Column<
    AppTableFeatures,
    TData,
    TValue
>;
export type AppRow<TData extends RowData> = Row<AppTableFeatures, TData>;
export type AppTable<TData extends RowData> = ReactTable<
    AppTableFeatures,
    TData
>;
export type AppTableCore<TData extends RowData> = Table<
    AppTableFeatures,
    TData
>;
export type AppCell<TData extends RowData, TValue = unknown> = Cell<
    AppTableFeatures,
    TData,
    TValue
>;
export type AppHeader<TData extends RowData, TValue = unknown> = Header<
    AppTableFeatures,
    TData,
    TValue
>;
export type AppCellContext<
    TData extends RowData,
    TValue = unknown
> = CellContext<AppTableFeatures, TData, TValue>;

function resolveColumnDefId<TData extends RowData>(
    column: AppColumnDef<TData>
) {
    const columnId =
        ('id' in column ? column.id : undefined) ??
        ('accessorKey' in column ? column.accessorKey : undefined);
    return typeof columnId === 'string' ? columnId : null;
}

function dropVisibilityOfUnhidableColumns<TData extends RowData>(
    columns: readonly AppColumnDef<TData>[],
    columnVisibility: ColumnVisibilityState
) {
    let resolved = columnVisibility;

    for (const column of columns) {
        if (column.enableHiding !== false) {
            continue;
        }
        const columnId = resolveColumnDefId(column);
        if (!columnId || resolved[columnId] !== false) {
            continue;
        }
        if (resolved === columnVisibility) {
            resolved = { ...columnVisibility };
        }
        delete resolved[columnId];
    }

    return resolved;
}

export function useAppTable<TData extends RowData>(
    options: Omit<TableOptions<AppTableFeatures, TData>, 'features'>
): AppTable<TData> {
    const columns = options.columns;
    const columnVisibility = options.state?.columnVisibility;
    const state = useMemo(() => {
        if (!options.state || !columnVisibility) {
            return options.state;
        }
        const resolvedVisibility = dropVisibilityOfUnhidableColumns(
            columns,
            columnVisibility
        );
        return resolvedVisibility === columnVisibility
            ? options.state
            : { ...options.state, columnVisibility: resolvedVisibility };
    }, [columns, columnVisibility, options.state]);

    return useTable({ ...options, state, features: appTableFeatures });
}
