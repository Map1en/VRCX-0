import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    horizontalListSortingStrategy,
    sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import {
    flexRender,
    getCoreRowModel,
    useReactTable
} from '@tanstack/react-table';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils.js';
import { Badge } from '@/ui/shadcn/badge';
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
import { ResizableTableHead } from './ResizableTableParts.jsx';
import {
    getColumnOrder,
    getColumnOrderLocked,
    getReorderableColumnIds
} from './tableColumnLayout.js';
import { TableColumnHeaderContextMenu } from './TableColumnVisibilityMenu.jsx';

function moveColumnByDrag(table, activeId, overId) {
    if (!activeId || !overId || activeId === overId) {
        return;
    }

    const columnOrder = getColumnOrder(table);
    const activeIndex = columnOrder.indexOf(activeId);
    const overIndex = columnOrder.indexOf(overId);

    if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
        return;
    }

    table.setColumnOrder(arrayMove(columnOrder, activeIndex, overIndex));
}

export function DataTableHeader({
    table,
    className = '',
    enableColumnReorder = true,
    getHeaderStyle,
    onResetLayout
}) {
    const columnOrderLocked = getColumnOrderLocked(table);
    const reorderableColumnIds = getReorderableColumnIds(table);
    const canReorder =
        enableColumnReorder &&
        !columnOrderLocked &&
        reorderableColumnIds.length > 1;
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 6
            }
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates
        })
    );

    const tableHeader = (
        <TableHeader className={className}>
            {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                        <ResizableTableHead
                            key={header.id}
                            header={header}
                            enableColumnReorder={canReorder}
                            style={getHeaderStyle?.(header.column, header)}
                        />
                    ))}
                </TableRow>
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

    if (!canReorder) {
        return headerWithMenu;
    }

    return (
        <DndContext
            accessibility={
                typeof document === 'undefined'
                    ? undefined
                    : { container: document.body }
            }
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => {
                moveColumnByDrag(table, event.active?.id, event.over?.id);
            }}
        >
            <SortableContext
                items={reorderableColumnIds}
                strategy={horizontalListSortingStrategy}
            >
                {headerWithMenu}
            </SortableContext>
        </DndContext>
    );
}

export function DataTableSurface({ className = '', children }) {
    return (
        <div
            className={cn(
                'app-data-table bg-background min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border',
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
}) {
    return (
        <div
            className={cn(
                'h-full min-h-0 min-w-0 overflow-auto',
                wideTable &&
                    '[&>[data-slot=table-container]]:w-max [&>[data-slot=table-container]]:min-w-full [&>[data-slot=table-container]]:overflow-visible',
                className
            )}
        >
            {children}
        </div>
    );
}

export function DataTableEmptyRow({ colSpan = 1, className = '', children }) {
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

export function DataTablePagination({
    table,
    summary,
    pageIndex,
    pageCount,
    pageSize,
    pageSizes = [],
    pageSizeLabel = 'Rows per page',
    onPageSizeChange,
    previousLabel = 'Previous',
    nextLabel = 'Next',
    className = ''
}) {
    const { t } = useTranslation();

    const resolvedPageIndex = Number.isFinite(pageIndex)
        ? pageIndex
        : (table?.getState?.().pagination?.pageIndex ?? 0);
    const resolvedPageCount = Math.max(
        1,
        Number.isFinite(pageCount) ? pageCount : table?.getPageCount?.() || 1
    );
    const resolvedPageSize = Number.isFinite(pageSize)
        ? pageSize
        : table?.getState?.().pagination?.pageSize;
    const pageSizeOptions = Array.isArray(pageSizes)
        ? pageSizes
              .map((value) => Number.parseInt(value, 10))
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
                        {pageSizeLabel}
                    </span>
                    <Select
                        value={String(resolvedPageSize)}
                        onValueChange={onPageSizeChange}
                    >
                        <SelectTrigger size="sm" className="w-20">
                            <SelectValue placeholder={pageSizeLabel} />
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
                            aria-label={previousLabel}
                            disabled={!table?.getCanPreviousPage?.()}
                            onClick={() => table?.previousPage?.()}
                        >
                            <ChevronLeftIcon data-icon="inline-start" />
                            {previousLabel}
                        </Button>
                    </PaginationItem>
                    <PaginationItem>
                        <Badge variant="outline">
                            {t('table.generated.page')} {resolvedPageIndex + 1} / {resolvedPageCount}
                        </Badge>
                    </PaginationItem>
                    <PaginationItem>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={nextLabel}
                            disabled={!table?.getCanNextPage?.()}
                            onClick={() => table?.nextPage?.()}
                        >
                            {nextLabel}
                            <ChevronRightIcon data-icon="inline-end" />
                        </Button>
                    </PaginationItem>
                </PaginationContent>
            </Pagination>
            {summary ? <span className="sr-only">{summary}</span> : null}
        </div>
    );
}

export function DataTableView({
    columns = [],
    data = [],
    emptyLabel = 'No rows yet.'
}) {
    const table = useReactTable({
        columns,
        data,
        getCoreRowModel: getCoreRowModel()
    });

    return (
        <DataTableSurface>
            <Table>
                <DataTableHeader table={table} />
                <TableBody>
                    {table.getRowModel().rows.length > 0 ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow key={row.id}>
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id}>
                                        {flexRender(
                                            cell.column.columnDef.cell,
                                            cell.getContext()
                                        )}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <DataTableEmptyRow
                            colSpan={table.getVisibleLeafColumns().length || 1}
                        >
                            {emptyLabel}
                        </DataTableEmptyRow>
                    )}
                </TableBody>
            </Table>
        </DataTableSurface>
    );
}
