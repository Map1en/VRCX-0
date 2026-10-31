import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RowData } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { GripVerticalIcon } from 'lucide-react';
import type { CSSProperties, ComponentProps, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { TableCell, TableHead } from '@/ui/shadcn/table';

import type { AppCell, AppHeader, AppTable } from './appTable';
import { useDataTableColumnDnd } from './dataTableColumnDndContext';
import { DataTableColumnResizeHandle } from './DataTableColumnResizeHandle';
import {
    DATA_TABLE_CELL_CLASS_NAME,
    DATA_TABLE_HEAD_CLASS_NAME
} from './dataTableStyles';
import { isColumnReorderable, resolveColumnLabel } from './tableColumnLayout';
import { TableColumnContextMenu } from './TableColumnVisibilityMenu';

type DragHandleProps = Partial<ComponentProps<typeof Button>>;

type ColumnMenuProps<TData extends RowData> = {
    table: AppTable<TData>;
    enableColumnReorder: boolean;
    onResetLayout?: (table: AppTable<TData>) => void;
};

function ResizableTableHeadContent<TData extends RowData>({
    header,
    dragHandleProps,
    columnMenu
}: {
    header: AppHeader<TData>;
    dragHandleProps?: DragHandleProps;
    columnMenu: ColumnMenuProps<TData>;
}) {
    const { t } = useTranslation();
    const columnLabel = resolveColumnLabel(header.column);

    return (
        <TableColumnContextMenu
            column={header.column}
            table={columnMenu.table}
            enableColumnReorder={columnMenu.enableColumnReorder}
            onResetLayout={columnMenu.onResetLayout}
        >
            <div className="flex min-w-0 items-center gap-2 pr-2">
                <div
                    data-slot="table-head-content"
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                >
                    <div className="min-w-0">
                        {header.isPlaceholder
                            ? null
                            : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                              )}
                    </div>
                    {dragHandleProps ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('accessibility.reorder_column', {
                                column: columnLabel
                            })}
                            className="shrink-0 cursor-grab opacity-0 group-hover:opacity-100 active:cursor-grabbing"
                            {...dragHandleProps}
                        >
                            <GripVerticalIcon data-icon="inline-end" />
                        </Button>
                    ) : null}
                </div>
                {header.column.getCanResize() ? (
                    <DataTableColumnResizeHandle
                        header={header}
                        label={columnLabel}
                    />
                ) : null}
            </div>
        </TableColumnContextMenu>
    );
}

function ResizableTableHeadBase<TData extends RowData>({
    header,
    className = '',
    style,
    columnMenu
}: {
    header: AppHeader<TData>;
    className?: string;
    style?: CSSProperties;
    columnMenu: ColumnMenuProps<TData>;
}) {
    return (
        <TableHead
            className={cn(
                DATA_TABLE_HEAD_CLASS_NAME,
                'group relative select-none',
                className
            )}
            style={style}
        >
            <ResizableTableHeadContent
                header={header}
                columnMenu={columnMenu}
            />
        </TableHead>
    );
}

function SortableResizableTableHead<TData extends RowData>({
    header,
    className = '',
    style,
    columnMenu
}: {
    header: AppHeader<TData>;
    className?: string;
    style?: CSSProperties;
    columnMenu: ColumnMenuProps<TData>;
}) {
    const {
        attributes,
        listeners,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: header.column.id });

    const dragHandleProps: DragHandleProps = {
        ...attributes,
        ...listeners,
        ref: setActivatorNodeRef,
        onClick: (event: MouseEvent<HTMLButtonElement>) =>
            event.stopPropagation()
    };

    return (
        <TableHead
            ref={setNodeRef}
            className={cn(
                DATA_TABLE_HEAD_CLASS_NAME,
                'group relative select-none',
                isDragging ? 'z-20 opacity-60' : '',
                className
            )}
            style={{
                ...style,
                transform: CSS.Translate.toString(transform),
                transition
            }}
        >
            <ResizableTableHeadContent
                header={header}
                dragHandleProps={dragHandleProps}
                columnMenu={columnMenu}
            />
        </TableHead>
    );
}

export function ResizableTableHead<TData extends RowData>({
    header,
    table,
    className = '',
    style,
    enableColumnReorder = false,
    onResetLayout
}: {
    header: AppHeader<TData>;
    table: AppTable<TData>;
    className?: string;
    style?: CSSProperties;
    enableColumnReorder?: boolean;
    onResetLayout?: (table: AppTable<TData>) => void;
}) {
    const resolvedClassName = cn(
        header.column.columnDef.meta?.tableHeadClassName,
        className
    );
    const columnMenu = { table, enableColumnReorder, onResetLayout };

    if (enableColumnReorder && isColumnReorderable(header?.column)) {
        return (
            <SortableResizableTableHead
                header={header}
                className={resolvedClassName}
                style={style}
                columnMenu={columnMenu}
            />
        );
    }

    return (
        <ResizableTableHeadBase
            header={header}
            className={resolvedClassName}
            style={style}
            columnMenu={columnMenu}
        />
    );
}

export function ResizableTableCell<TData extends RowData>({
    cell,
    className = '',
    style
}: {
    cell: AppCell<TData>;
    className?: string;
    style?: CSSProperties;
}) {
    const columnDnd = useDataTableColumnDnd();
    const resolvedClassName = cn(
        cell.column.columnDef.meta?.tableCellClassName,
        className
    );

    if (columnDnd.enabled && isColumnReorderable(cell?.column)) {
        return (
            <SortableResizableTableCell
                cell={cell}
                className={resolvedClassName}
                style={style}
            />
        );
    }

    return (
        <TableCell
            className={cn(DATA_TABLE_CELL_CLASS_NAME, resolvedClassName)}
            style={style}
        >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
    );
}

function SortableResizableTableCell<TData extends RowData>({
    cell,
    className = '',
    style
}: {
    cell: AppCell<TData>;
    className?: string;
    style?: CSSProperties;
}) {
    const { setNodeRef, transform, transition, isDragging } = useSortable({
        id: cell.column.id
    });

    return (
        <TableCell
            ref={setNodeRef}
            className={cn(
                DATA_TABLE_CELL_CLASS_NAME,
                isDragging ? 'relative z-10 opacity-60' : 'relative',
                className
            )}
            style={{
                ...style,
                transform: CSS.Translate.toString(transform),
                transition
            }}
        >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
    );
}
