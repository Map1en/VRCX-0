import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RowData } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { GripVerticalIcon } from 'lucide-react';
import type {
    CSSProperties,
    ComponentProps,
    KeyboardEvent,
    MouseEvent,
    PointerEvent
} from 'react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { TableCell, TableHead } from '@/ui/shadcn/table';

import type { AppCell, AppHeader } from './appTable';
import { useDataTableColumnDnd } from './dataTableColumnDndContext';
import {
    DATA_TABLE_CELL_CLASS_NAME,
    DATA_TABLE_HEAD_CLASS_NAME
} from './dataTableStyles';
import { getStretchColumnId, isColumnReorderable } from './tableColumnLayout';

type DragHandleProps = Partial<ComponentProps<typeof Button>>;

type StretchResizeSession = {
    pointerId: number;
    startX: number;
    startWidth: number;
};

function clampColumnSize<TData extends RowData>(
    header: AppHeader<TData>,
    size: number
) {
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;
    return Math.min(maxSize, Math.max(minSize, Math.round(size)));
}

function measureHeaderWidth<TData extends RowData>(
    element: HTMLElement,
    header: AppHeader<TData>
) {
    const headerCell = element.closest('th');
    return headerCell
        ? headerCell.getBoundingClientRect().width
        : header.column.getSize();
}

function resizeHeaderFromKeyboard<TData extends RowData>(
    event: KeyboardEvent<HTMLButtonElement>,
    header: AppHeader<TData>,
    baseSize: number
) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
    }

    event.preventDefault();

    const table = header.getContext().table;
    const direction = table.options.columnResizeDirection === 'rtl' ? -1 : 1;
    const step = event.shiftKey ? 32 : 16;
    const delta =
        event.key === 'ArrowRight' ? step * direction : -step * direction;
    const nextSize = clampColumnSize(header, baseSize + delta);

    table.setColumnSizing((current) => ({
        ...current,
        [header.column.id]: nextSize
    }));
}

function ResizableTableHeadContent<TData extends RowData>({
    header,
    dragHandleProps
}: {
    header: AppHeader<TData>;
    dragHandleProps?: DragHandleProps;
}) {
    const { t } = useTranslation();
    const canResize = header.column.getCanResize();
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;
    const stretchResizeRef = useRef<StretchResizeSession | null>(null);
    const stretchHeader =
        getStretchColumnId(header.getContext().table) === header.column.id;

    function startStretchResize(event: PointerEvent<HTMLButtonElement>) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        stretchResizeRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: measureHeaderWidth(event.currentTarget, header)
        };
    }

    function updateStretchResize(event: PointerEvent<HTMLButtonElement>) {
        const session = stretchResizeRef.current;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }

        const nextSize = clampColumnSize(
            header,
            session.startWidth + event.clientX - session.startX
        );
        header.getContext().table.setColumnSizing((current) => ({
            ...current,
            [header.column.id]: nextSize
        }));
    }

    function endStretchResize(event: PointerEvent<HTMLButtonElement>) {
        const session = stretchResizeRef.current;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }

        updateStretchResize(event);
        stretchResizeRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
    }

    return (
        <div className="flex min-w-0 items-center gap-2 pr-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
                            column: header.column.id
                        })}
                        className="shrink-0 cursor-grab opacity-0 group-hover:opacity-100 active:cursor-grabbing"
                        {...dragHandleProps}
                    >
                        <GripVerticalIcon data-icon="inline-end" />
                    </Button>
                ) : null}
            </div>
            {canResize ? (
                <Button
                    type="button"
                    variant="ghost"
                    role="slider"
                    aria-label={t('accessibility.resize_column', {
                        column: header.column.id
                    })}
                    aria-orientation="horizontal"
                    aria-valuemin={minSize}
                    aria-valuemax={maxSize}
                    aria-valuenow={header.column.getSize()}
                    aria-valuetext={`${header.column.getSize()} pixels`}
                    className={cn(
                        'hover:bg-border absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none rounded-none border-0 bg-transparent p-0',
                        header.column.getIsResizing() ? 'bg-primary' : ''
                    )}
                    onMouseDown={
                        stretchHeader ? undefined : header.getResizeHandler()
                    }
                    onTouchStart={
                        stretchHeader ? undefined : header.getResizeHandler()
                    }
                    onPointerDown={
                        stretchHeader ? startStretchResize : undefined
                    }
                    onPointerMove={
                        stretchHeader ? updateStretchResize : undefined
                    }
                    onPointerUp={stretchHeader ? endStretchResize : undefined}
                    onPointerCancel={
                        stretchHeader ? endStretchResize : undefined
                    }
                    onKeyDown={(event) =>
                        resizeHeaderFromKeyboard(
                            event,
                            header,
                            stretchHeader
                                ? measureHeaderWidth(
                                      event.currentTarget,
                                      header
                                  )
                                : header.column.getSize()
                        )
                    }
                />
            ) : null}
        </div>
    );
}

function ResizableTableHeadBase<TData extends RowData>({
    header,
    className = '',
    style
}: {
    header: AppHeader<TData>;
    className?: string;
    style?: CSSProperties;
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
            <ResizableTableHeadContent header={header} />
        </TableHead>
    );
}

function SortableResizableTableHead<TData extends RowData>({
    header,
    className = '',
    style
}: {
    header: AppHeader<TData>;
    className?: string;
    style?: CSSProperties;
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
            />
        </TableHead>
    );
}

export function ResizableTableHead<TData extends RowData>({
    header,
    className = '',
    style,
    enableColumnReorder = false
}: {
    header: AppHeader<TData>;
    className?: string;
    style?: CSSProperties;
    enableColumnReorder?: boolean;
}) {
    if (enableColumnReorder && isColumnReorderable(header?.column)) {
        return (
            <SortableResizableTableHead
                header={header}
                className={className}
                style={style}
            />
        );
    }

    return (
        <ResizableTableHeadBase
            header={header}
            className={className}
            style={style}
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
