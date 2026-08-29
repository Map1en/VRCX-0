import {
    DndContext,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    closestCenter,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import type { UniqueIdentifier } from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
    SortableContext,
    arrayMove,
    horizontalListSortingStrategy,
    sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import type { RowData } from '@tanstack/react-table';
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

import type { AppColumn, AppColumnDef, AppHeader, AppTable } from './appTable';
import { useAppTable } from './appTable';
import {
    DataTableColumnDndContext,
    dataTableColumnDndDefaultState,
    useDataTableColumnDnd
} from './dataTableColumnDndContext';
import {
    sanitizeTableColumnOrder,
    usePersistedDataTableLayout
} from './dataTablePersistence';
import { ResizableTableCell, ResizableTableHead } from './ResizableTableParts';
import {
    getColumnOrder,
    getColumnOrderLocked,
    getReorderableColumnIds,
    getStretchColumnId
} from './tableColumnLayout';
import { TableColumnHeaderContextMenu } from './TableColumnVisibilityMenu';

function moveColumnByDrag<TData extends RowData>(
    table: AppTable<TData>,
    activeId: UniqueIdentifier,
    overId: UniqueIdentifier | undefined
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

function getColumnId<TData extends RowData>(column: AppColumnDef<TData>) {
    const columnId =
        ('id' in column ? column.id : undefined) ??
        ('accessorKey' in column ? column.accessorKey : null);
    return typeof columnId === 'string' ? columnId : null;
}

export function getDataTableSizingStyle<TData extends RowData>(
    table: AppTable<TData>
): CSSProperties {
    const totalSize = table.getTotalSize();
    if (!Number.isFinite(totalSize) || totalSize <= 0) {
        return { width: '100%' };
    }
    return getStretchColumnId(table)
        ? { width: `max(100%, ${totalSize}px)` }
        : { width: `${totalSize}px` };
}

export function DataTableColumnSizeColGroup<TData extends RowData>({
    table
}: {
    table: AppTable<TData>;
}) {
    const stretchColumnId = getStretchColumnId(table);

    return (
        <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
                <col
                    key={column.id}
                    style={
                        column.id === stretchColumnId
                            ? undefined
                            : { width: `${column.getSize()}px` }
                    }
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
    table: AppTable<TData>;
    enableColumnReorder?: boolean;
    children: ReactNode;
}) {
    const columnOrderLocked = getColumnOrderLocked(table);
    const visibleLeafColumns = table.getVisibleLeafColumns();
    const reorderableColumnIds = useMemo(
        () => getReorderableColumnIds(visibleLeafColumns),
        [visibleLeafColumns]
    );
    const canReorder =
        enableColumnReorder &&
        !columnOrderLocked &&
        reorderableColumnIds.length > 1;
    const sensors = useColumnDndSensors();
    const contextValue = useMemo(
        () =>
            canReorder
                ? {
                      enabled: true,
                      items: reorderableColumnIds,
                      table
                  }
                : dataTableColumnDndDefaultState,
        [canReorder, reorderableColumnIds, table]
    );

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
    table: AppTable<TData>;
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
    table: AppTable<TData>;
    className?: string;
    enableColumnReorder?: boolean;
    getHeaderStyle?: (
        column: AppColumn<TData>,
        header: AppHeader<TData>
    ) => CSSProperties | undefined;
    onResetLayout?: (table: AppTable<TData>) => void;
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
    children
}: {
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={cn(
                'h-full min-h-0 min-w-0 overflow-auto [&>[data-slot=table-container]]:min-w-full [&>[data-slot=table-container]]:overflow-visible',
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
    table: AppTable<TData>;
    summary?: ReactNode;
    pageIndex?: number;
    pageCount?: number;
    pageSize?: number;
    pageSizes?: readonly number[];
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
            : (table.state.pagination?.pageIndex ?? 0);
    const resolvedPageCount = Math.max(
        1,
        typeof pageCount === 'number' && Number.isFinite(pageCount)
            ? pageCount
            : table.getPageCount() || 1
    );
    const resolvedPageSize =
        typeof pageSize === 'number' && Number.isFinite(pageSize)
            ? pageSize
            : table.state.pagination?.pageSize;
    const pageSizeOptions = pageSizes.filter(
        (value) => Number.isFinite(value) && value > 0
    );
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
                    <Select<string>
                        value={String(resolvedPageSize)}
                        onValueChange={(value) => {
                            if (value) {
                                onPageSizeChange?.(value);
                            }
                        }}
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
    columns?: AppColumnDef<TData>[];
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
    const {
        columnOrder,
        columnSizing,
        setColumnOrder,
        setColumnSizing,
        writePersistedState
    } = usePersistedDataTableLayout({
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

        writePersistedState({
            columnOrder: sanitizeTableColumnOrder(columnOrder, columnIds)
        });
    }, [columnIds, columnOrder, persistTableLayout, writePersistedState]);

    const table = useAppTable<TData>({
        columns,
        data,
        state: persistTableLayout
            ? {
                  columnOrder,
                  columnSizing
              }
            : undefined,
        onColumnOrderChange: persistTableLayout ? setColumnOrder : undefined,
        onColumnSizingChange: persistTableLayout ? setColumnSizing : undefined,
        enableColumnResizing: persistTableLayout,
        columnResizeMode: 'onChange'
    });

    return (
        <DataTableSurface>
            <DataTableScrollArea>
                <DataTableColumnDndProvider table={table}>
                    <Table
                        className="table-fixed"
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
