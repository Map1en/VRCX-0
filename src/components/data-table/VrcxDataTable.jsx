import {
    flexRender,
    getCoreRowModel,
    useReactTable
} from '@tanstack/react-table';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table.jsx';

export function DataTableSurface({ className = '', children }) {
    return (
        <div
            className={cn(
                'vrcx-data-table min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border bg-background',
                className
            )}>
            {children}
        </div>
    );
}

export function DataTableScrollArea({ className = '', children }) {
    return (
        <div className={cn('h-full min-h-0 overflow-auto', className)}>
            {children}
        </div>
    );
}

export function DataTableEmptyRow({ colSpan = 1, className = '', children }) {
    return (
        <TableRow>
            <TableCell
                colSpan={colSpan}
                className={cn('h-24 text-center text-muted-foreground', className)}>
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
    previousLabel = 'Previous',
    nextLabel = 'Next',
    className = ''
}) {
    const resolvedPageIndex = Number.isFinite(pageIndex)
        ? pageIndex
        : table?.getState?.().pagination?.pageIndex ?? 0;
    const resolvedPageCount = Math.max(
        1,
        Number.isFinite(pageCount) ? pageCount : table?.getPageCount?.() || 1
    );

    return (
        <div className={cn('flex items-center gap-2', className)}>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!table?.getCanPreviousPage?.()}
                onClick={() => table?.previousPage?.()}>
                <ChevronLeftIcon className="size-4" />
                {previousLabel}
            </Button>
            <Badge variant="outline">
                Page {resolvedPageIndex + 1} / {resolvedPageCount}
            </Badge>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!table?.getCanNextPage?.()}
                onClick={() => table?.nextPage?.()}>
                {nextLabel}
                <ChevronRightIcon className="size-4" />
            </Button>
            {summary ? <span className="sr-only">{summary}</span> : null}
        </div>
    );
}

export function VrcxDataTable({ columns = [], data = [], emptyLabel = 'No rows yet.' }) {
    const table = useReactTable({
        columns,
        data,
        getCoreRowModel: getCoreRowModel()
    });

    return (
        <DataTableSurface>
            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <TableHead key={header.id}>
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(
                                              header.column.columnDef.header,
                                              header.getContext()
                                          )}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
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
                        <DataTableEmptyRow colSpan={table.getVisibleLeafColumns().length || 1}>
                            {emptyLabel}
                        </DataTableEmptyRow>
                    )}
                </TableBody>
            </Table>
        </DataTableSurface>
    );
}
