import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Cell, Header, RowData } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { GripVerticalIcon } from 'lucide-react';
import type {
    CSSProperties,
    ComponentProps,
    KeyboardEvent,
    MouseEvent
} from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { TableCell, TableHead } from '@/ui/shadcn/table';

import { useDataTableColumnDnd } from './dataTableColumnDndContext';
import { isColumnReorderable } from './tableColumnLayout';

type DragHandleProps = Partial<ComponentProps<typeof Button>>;

function resolveSize(value: unknown) {
    const size = Number(value);
    return Number.isFinite(size) && size > 0 ? `${size}px` : undefined;
}

function resizeHeaderFromKeyboard<TData extends RowData>(
    event: KeyboardEvent<HTMLButtonElement>,
    header: Header<TData, unknown>
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
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;
    const nextSize = Math.min(
        maxSize,
        Math.max(minSize, header.column.getSize() + delta)
    );

    table.setColumnSizing((current) => ({
        ...current,
        [header.column.id]: nextSize
    }));
}

function ResizableTableHeadContent<TData extends RowData>({
    header,
    dragHandleProps
}: {
    header: Header<TData, unknown>;
    dragHandleProps?: DragHandleProps;
}) {
    const { t } = useTranslation();
    const canResize = header.column.getCanResize();
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;

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
                    onMouseDown={header.getResizeHandler()}
                    onKeyDown={(event) =>
                        resizeHeaderFromKeyboard(event, header)
                    }
                    onTouchStart={header.getResizeHandler()}
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
    header: Header<TData, unknown>;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <TableHead
            className={cn('group relative select-none', className)}
            style={{
                ...style,
                width: resolveSize(header.getSize())
            }}
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
    header: Header<TData, unknown>;
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
                'group relative select-none',
                isDragging ? 'z-20 opacity-60' : '',
                className
            )}
            style={{
                ...style,
                width: resolveSize(header.getSize()),
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
    header: Header<TData, unknown>;
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
    cell: Cell<TData, unknown>;
    className?: string;
    style?: CSSProperties;
}) {
    const columnDnd = useDataTableColumnDnd();

    if (columnDnd.enabled && isColumnReorderable(cell?.column)) {
        return (
            <SortableResizableTableCell
                cell={cell}
                className={className}
                style={style}
            />
        );
    }

    return (
        <TableCell
            className={className}
            style={{
                ...style,
                width: resolveSize(cell.column.getSize())
            }}
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
    cell: Cell<TData, unknown>;
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
                isDragging ? 'relative z-10 opacity-60' : 'relative',
                className
            )}
            style={{
                ...style,
                width: resolveSize(cell.column.getSize()),
                transform: CSS.Translate.toString(transform),
                transition
            }}
        >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
    );
}
