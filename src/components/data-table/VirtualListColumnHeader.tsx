import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RowData } from '@tanstack/react-table';
import type { CSSProperties, MouseEvent } from 'react';

import { cn } from '@/lib/utils';

import type { AppHeader, AppTable } from './appTable';
import { useDataTableColumnDnd } from './dataTableColumnDndContext';
import {
    DataTableColumnDragHandle,
    type DataTableColumnDragHandleProps
} from './DataTableColumnDragHandle';
import { DataTableColumnResizeHandle } from './DataTableColumnResizeHandle';
import { DataTableHeaderLabel } from './DataTableSortButton';
import {
    DataTableColumnDndProvider,
    DataTableColumnSortableContext
} from './DataTableView';
import {
    getColumnOrderLocked,
    isColumnReorderable,
    isColumnToggleable,
    resolveColumnLabel
} from './tableColumnLayout';
import {
    TableColumnContextMenu,
    TableColumnHeaderContextMenu
} from './TableColumnVisibilityMenu';

type HeaderCellProps<TData extends RowData> = {
    header: AppHeader<TData>;
    table: AppTable<TData>;
};

function HeaderCellContent<TData extends RowData>({
    dragHandleProps,
    header,
    table
}: HeaderCellProps<TData> & {
    dragHandleProps?: DataTableColumnDragHandleProps;
}) {
    const label = resolveColumnLabel(header.column);
    return (
        <TableColumnContextMenu
            column={header.column}
            table={table}
            enableColumnReorder={!getColumnOrderLocked(table)}
        >
            <div className="relative flex h-full min-w-0 items-center gap-1.5 px-[var(--vrcx-0-table-cell-padding-inline)]">
                <DataTableHeaderLabel className="min-w-0 truncate">
                    {label}
                </DataTableHeaderLabel>
                {dragHandleProps ? (
                    <DataTableColumnDragHandle
                        label={label}
                        {...dragHandleProps}
                    />
                ) : null}
                {header.column.getCanResize() ? (
                    <DataTableColumnResizeHandle
                        header={header}
                        label={label}
                    />
                ) : null}
            </div>
        </TableColumnContextMenu>
    );
}

function SortableHeaderCell<TData extends RowData>({
    header,
    table
}: HeaderCellProps<TData>) {
    const {
        attributes,
        listeners,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: header.column.id });
    return (
        <div
            ref={setNodeRef}
            className={cn(
                'group relative h-full min-w-0 select-none',
                isDragging && 'z-20 opacity-60'
            )}
            style={{ transform: CSS.Translate.toString(transform), transition }}
        >
            <HeaderCellContent
                header={header}
                table={table}
                dragHandleProps={{
                    ...attributes,
                    ...listeners,
                    ref: setActivatorNodeRef,
                    onClick: (event: MouseEvent<HTMLButtonElement>) =>
                        event.stopPropagation()
                }}
            />
        </div>
    );
}

function HeaderRow<TData extends RowData>({
    layout,
    table
}: {
    layout: CSSProperties;
    table: AppTable<TData>;
}) {
    const columnDnd = useDataTableColumnDnd();
    const headers = table.getHeaderGroups().flatMap((group) => group.headers);
    return (
        <DataTableColumnSortableContext table={table}>
            <TableColumnHeaderContextMenu table={table}>
                <div
                    className="grid h-[var(--vrcx-0-table-header-height)] items-center"
                    style={layout}
                >
                    {headers.map((header) =>
                        !isColumnReorderable(header.column) &&
                        !isColumnToggleable(header.column) ? (
                            <span key={header.id} aria-hidden="true" />
                        ) : columnDnd.enabled &&
                          isColumnReorderable(header.column) ? (
                            <SortableHeaderCell
                                key={header.id}
                                header={header}
                                table={table}
                            />
                        ) : (
                            <div key={header.id} className="h-full min-w-0">
                                <HeaderCellContent
                                    header={header}
                                    table={table}
                                />
                            </div>
                        )
                    )}
                </div>
            </TableColumnHeaderContextMenu>
        </DataTableColumnSortableContext>
    );
}

export function VirtualListColumnHeader<TData extends RowData>({
    layout,
    table
}: {
    layout: CSSProperties;
    table: AppTable<TData>;
}) {
    return (
        <DataTableColumnDndProvider table={table}>
            <HeaderRow layout={layout} table={table} />
        </DataTableColumnDndProvider>
    );
}
