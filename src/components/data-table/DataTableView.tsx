import {
    DndContext,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    closestCenter,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
    SortableContext,
    arrayMove,
    horizontalListSortingStrategy,
    sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import type {
    Column,
    ColumnDef,
    Header,
    RowData,
    Table as ReactTable
} from '@tanstack/react-table';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import {
    Pagination,
    PaginationContent,
    PaginationItem
} from '@/ui/shadcn/pagination';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';

import {
    DataTableColumnDndContext,
    dataTableColumnDndDefaultState,
    useDataTableColumnDnd
} from './dataTableColumnDndContext';
import {
    sanitizeTableColumnOrder,
    sanitizeTableColumnSizing,
    usePersistedDataTableLayout
} from './dataTablePersistence';
import { ResizableTableCell, ResizableTableHead } from './ResizableTableParts';
import {
    getColumnOrder,
    getColumnOrderLocked,
    getReorderableColumnIds
} from './tableColumnLayout';
import { TableColumnHeaderContextMenu } from './TableColumnVisibilityMenu';

function moveColumnByDrag<TData extends RowData>(
    table: ReactTable<TData>,
    activeId: unknown,
    overId: unknown
) {
    if (!activeId || !overId || activeId === overId) {
        return;
    }

    const activeColumnId = String(activeId);
    const overColumnId = String(overId);
    const columnOrder = getColumnOrder(table);
    const activeIndex = columnOrder.indexOf(activeColumnId);
    const overIndex = columnOrder.indexOf(overColumnId);

    if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
        return;
    }

    table.setColumnOrder(arrayMove(columnOrder, activeIndex, overIndex));
}

function getColumnId<TData extends RowData>(column: ColumnDef<TData, unknown>) {
    const source = column as { id?: unknown; accessorKey?: unknown };
    const columnId = source.id ?? source.accessorKey ?? null;
    return typeof columnId === 'string' ? columnId : null;
}

export function getDataTableSizingStyle<TData extends RowData>(
    table: ReactTable<TData>
): CSSProperties | undefined {
    const totalSize = table.getTotalSize();
    return Number.isFinite(totalSize) && totalSize > 0
        ? { width: `${totalSize}px` }
        : undefined;
}

export function DataTableColumnSizeColGroup<TData extends RowData>({
    table
}: {
    table: ReactTable<TData>;
}) {
    return (
        <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
                <col
                    key={column.id}
                    style={{
                        width: `${column.getSize()}px`
                    }}
                />
            ))}
        </colgroup>
    );
}

function useColumnDndSensors() {
    return useSensors(
        useSensor(MouseSensor, {
            activationConstraint: {
                distance: 6
            }
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                distance: 6
            }
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates
        })
    );
}

export function DataTableColumnDndProvider<TData extends RowData>({
    table,
    enableColumnReorder = true,
    children
}: {
    table: ReactTable<TData>;
    enableColumnReorder?: boolean;
    children: ReactNode;
}) {
    const columnOrderLocked = getColumnOrderLocked(table);
    const reorderableColumnIds = getReorderableColumnIds(table);
    const canReorder =
        enableColumnReorder &&
        !columnOrderLocked &&
        reorderableColumnIds.length > 1;
    const sensors = useColumnDndSensors();
    const contextValue = canReorder
        ? {
              enabled: true,
              items: reorderableColumnIds,
              table
          }
        : dataTableColumnDndDefaultState;

    if (!canReorder) {
        return (
            <DataTableColumnDndContext.Provider value={contextValue}>
                {children}
            </DataTableColumnDndContext.Provider>
        );
    }

    return (
        <DataTableColumnDndContext.Provider value={contextValue}>
            <DndContext
                accessibility={
                    typeof document === 'undefined'
                        ? undefined
                        : { container: document.body }
                }
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToHorizontalAxis]}
                onDragEnd={(event) => {
                    moveColumnByDrag(table, event.active?.id, event.over?.id);
                }}
            >
                {children}
            </DndContext>
        </DataTableColumnDndContext.Provider>
    );
}

export function DataTableColumnSortableContext<TData extends RowData>({
    table,
    children
}: {
    table: ReactTable<TData>;
    children: ReactNode;
}) {
    const columnDnd = useDataTableColumnDnd();

    if (!columnDnd.enabled || columnDnd.table !== table) {
        return children;
    }

    return (
        <SortableContext
            items={columnDnd.items}
            strategy={horizontalListSortingStrategy}
        >
            {children}
        </SortableContext>
    );
}

export function DataTableHeader<TData extends RowData>({
    table,
    className = '',
    enableColumnReorder = true,
    getHeaderStyle,
    onResetLayout
}: {
    table: ReactTable<TData>;
    className?: string;
    enableColumnReorder?: boolean;
    getHeaderStyle?: (
        column: Column<TData, unknown>,
        header: Header<TData, unknown>
    ) => CSSProperties | undefined;
    onResetLayout?: (table: ReactTable<TData>) => void;
}) {
    const columnDnd = useDataTableColumnDnd();
    const canReorder = enableColumnReorder && columnDnd.enabled;

    const tableHeader = (
        <TableHeader className={className}>
            {table.getHeaderGroups().map((headerGroup) => (
                <DataTableColumnSortableContext
                    key={headerGroup.id}
                    table={table}
                >
                    <TableRow>
                        {headerGroup.headers.map((header) => (
                            <ResizableTableHead
                                key={header.id}
                                header={header}
                                enableColumnReorder={canReorder}
                                style={getHeaderStyle?.(header.column, header)}
                            />
                        ))}
                    </TableRow>
                </DataTableColumnSortableContext>
            ))}
        </TableHeader>
    );

    const headerWithMenu = (
        <TableColumnHeaderContextMenu
            table={table}
            onResetLayout={onResetLayout}
        >
            {tableHeader}
        </TableColumnHeaderContextMenu>
    );

    return headerWithMenu;
}

export function DataTableSurface({
    className = '',
    children
}: {
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            data-vrcx-0-surface="data-table"
            className={cn(
                'app-data-table vrcx-0-data-table min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border',
                className
            )}
        >
            {children}
        </div>
    );
}

export function DataTableScrollArea({
    className = '',
    wideTable = false,
    children
}: {
    className?: string;
    wideTable?: boolean;
    children: ReactNode;
}) {
    return (
        <div
            className={cn(
                'h-full min-h-0 min-w-0 overflow-auto [&>[data-slot=table-container]]:min-w-full [&>[data-slot=table-container]]:overflow-visible',
                wideTable && '[&>[data-slot=table-container]]:w-max',
                className
            )}
        >
            {children}
        </div>
    );
}

export function DataTableEmptyRow({
    colSpan = 1,
    className = '',
    children
}: {
    colSpan?: number;
    className?: string;
    children: ReactNode;
}) {
    return (
        <TableRow>
            <TableCell
                colSpan={colSpan}
                className={cn(
                    'text-muted-foreground h-24 text-center',
                    className
                )}
            >
                {children}
            </TableCell>
        </TableRow>
    );
}

export function DataTablePagination<TData extends RowData>({
    table,
    summary,
    pageIndex,
    pageCount,
    pageSize,
    pageSizes = [],
    pageSizeLabel,
    onPageSizeChange,
    previousLabel,
    nextLabel,
    className = ''
}: {
    table: ReactTable<TData>;
    summary?: ReactNode;
    pageIndex?: number;
    pageCount?: number;
    pageSize?: number;
    pageSizes?: unknown[];
    pageSizeLabel?: string;
    onPageSizeChange?: (value: string) => void;
    previousLabel?: string;
    nextLabel?: string;
    className?: string;
}) {
    const { t } = useTranslation();
    const resolvedPageSizeLabel =
        pageSizeLabel || t('table.pagination.rows_per_page');
    const resolvedPreviousLabel =
        previousLabel || t('table.pagination.previous');
    const resolvedNextLabel = nextLabel || t('table.pagination.next');

    const resolvedPageIndex =
        typeof pageIndex === 'number' && Number.isFinite(pageIndex)
            ? pageIndex
            : (table.getState().pagination?.pageIndex ?? 0);
    const resolvedPageCount = Math.max(
        1,
        typeof pageCount === 'number' && Number.isFinite(pageCount)
            ? pageCount
            : table.getPageCount() || 1
    );
    const resolvedPageSize =
        typeof pageSize === 'number' && Number.isFinite(pageSize)
            ? pageSize
            : table.getState().pagination?.pageSize;
    const pageSizeOptions = Array.isArray(pageSizes)
        ? pageSizes
              .map((value) => Number.parseInt(String(value), 10))
              .filter((value) => Number.isFinite(value) && value > 0)
        : [];
    const pageSizeSelectVisible = Boolean(
        pageSizeOptions.length &&
        Number.isFinite(resolvedPageSize) &&
        typeof onPageSizeChange === 'function'
    );

    return (
        <div className={cn('flex flex-wrap items-center gap-2', className)}>
            {pageSizeSelectVisible ? (
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm">
                        {resolvedPageSizeLabel}
                    </span>
                    <Select
                        value={String(resolvedPageSize)}
                        onValueChange={(value) =>
                            onPageSizeChange?.(value ?? '')
                        }
                    >
                        <SelectTrigger size="sm" className="w-20">
                            <SelectValue placeholder={resolvedPageSizeLabel} />
                        </SelectTrigger>
                        <SelectContent align="end">
                            <SelectGroup>
                                {pageSizeOptions.map((size) => (
                                    <SelectItem key={size} value={String(size)}>
                                        {size}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
            ) : null}
            <Pagination className="mx-0 w-auto justify-start">
                <PaginationContent>
                    <PaginationItem>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={resolvedPreviousLabel}
                            disabled={!table?.getCanPreviousPage?.()}
                            onClick={() => table?.previousPage?.()}
                        >
                            <ChevronLeftIcon data-icon="inline-start" />
                            {resolvedPreviousLabel}
                        </Button>
                    </PaginationItem>
                    <PaginationItem>
                        <div className="text-accent-foreground mx-2 text-xs">
                            {resolvedPageIndex + 1} / {resolvedPageCount}
                        </div>
                    </PaginationItem>
                    <PaginationItem>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={resolvedNextLabel}
                            disabled={!table?.getCanNextPage?.()}
                            onClick={() => table?.nextPage?.()}
                        >
                            {resolvedNextLabel}
                            <ChevronRightIcon data-icon="inline-end" />
                        </Button>
                    </PaginationItem>
                </PaginationContent>
            </Pagination>
            {summary ? <span className="sr-only">{summary}</span> : null}
        </div>
    );
}

export function DataTableView<TData extends RowData>({
    columns = [],
    data = [],
    emptyLabel,
    persistKey
}: {
    columns?: ColumnDef<TData, unknown>[];
    data?: TData[];
    emptyLabel?: string;
    persistKey?: string;
}) {
    const { t } = useTranslation();
    const resolvedEmptyLabel = emptyLabel || t('table.empty.no_rows_yet');
    const columnIds = useMemo(
        () =>
            columns
                .map((column) => getColumnId(column))
                .filter((columnId): columnId is string => Boolean(columnId)),
        [columns]
    );
    const tableLayout = usePersistedDataTableLayout({
        tableId: persistKey,
        columnIds
    });
    const hasWrittenLayoutRef = useRef(false);
    const persistTableLayout = Boolean(persistKey);

    useEffect(() => {
        if (!persistTableLayout) {
            return;
        }
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
            )
        });
    }, [
        columnIds,
        persistTableLayout,
        tableLayout.columnOrder,
        tableLayout.columnSizing,
        tableLayout.writePersistedState
    ]);

    const table = useReactTable<TData>({
        columns,
        data,
        state: persistTableLayout
            ? {
                  columnOrder: tableLayout.columnOrder,
                  columnSizing: tableLayout.columnSizing
              }
            : undefined,
        onColumnOrderChange: persistTableLayout
            ? tableLayout.setColumnOrder
            : undefined,
        onColumnSizingChange: persistTableLayout
            ? tableLayout.setColumnSizing
            : undefined,
        enableColumnResizing: persistTableLayout,
        columnResizeMode: 'onChange',
        getCoreRowModel: getCoreRowModel()
    });

    return (
        <DataTableSurface>
            <DataTableScrollArea>
                <DataTableColumnDndProvider table={table}>
                    <Table
                        className="min-w-full table-fixed"
                        style={getDataTableSizingStyle(table)}
                    >
                        <DataTableColumnSizeColGroup table={table} />
                        <DataTableHeader table={table} />
                        <TableBody>
                            {table.getRowModel().rows.length > 0 ? (
                                table.getRowModel().rows.map((row) => (
                                    <TableRow key={row.id}>
                                        <DataTableColumnSortableContext
                                            table={table}
                                        >
                                            {row
                                                .getVisibleCells()
                                                .map((cell) => (
                                                    <ResizableTableCell
                                                        key={cell.id}
                                                        cell={cell}
                                                    />
                                                ))}
                                        </DataTableColumnSortableContext>
                                    </TableRow>
                                ))
                            ) : (
                                <DataTableEmptyRow
                                    colSpan={
                                        table.getVisibleLeafColumns().length ||
                                        1
                                    }
                                >
                                    {resolvedEmptyLabel}
                                </DataTableEmptyRow>
                            )}
                        </TableBody>
                    </Table>
                </DataTableColumnDndProvider>
            </DataTableScrollArea>
        </DataTableSurface>
    );
}
