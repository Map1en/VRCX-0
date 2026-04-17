import { flexRender } from '@tanstack/react-table';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { GripVerticalIcon } from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';
import { TableCell, TableHead } from '@/ui/shadcn/table';
import { isColumnReorderable } from './tableColumnLayout.js';

function resolveSize(value) {
    const size = Number(value);
    return Number.isFinite(size) && size > 0 ? `${size}px` : undefined;
}

function resizeHeaderFromKeyboard(event, header) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
    }

    event.preventDefault();

    const table = header.getContext().table;
    const direction = table.options.columnResizeDirection === 'rtl' ? -1 : 1;
    const step = event.shiftKey ? 32 : 16;
    const delta = event.key === 'ArrowRight' ? step * direction : -step * direction;
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;
    const nextSize = Math.min(maxSize, Math.max(minSize, header.column.getSize() + delta));

    table.setColumnSizing((current) => ({
        ...current,
        [header.column.id]: nextSize
    }));
}

function ResizableTableHeadContent({ header, dragHandleProps }) {
    const canResize = header.column.getCanResize();
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;

    return (
        <div className="flex min-w-0 items-center gap-2 pr-2">
            {dragHandleProps ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Reorder ${header.column.id} column`}
                    className="shrink-0 cursor-grab opacity-0 active:cursor-grabbing group-hover:opacity-100"
                    {...dragHandleProps}>
                    <GripVerticalIcon data-icon="inline-start" />
                </Button>
            ) : null}
            <div className="min-w-0 flex-1">
                {header.isPlaceholder
                    ? null
                    : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                      )}
            </div>
            {canResize ? (
                <Button
                    type="button"
                    variant="ghost"
                    role="slider"
                    aria-label={`Resize ${header.column.id} column`}
                    aria-orientation="horizontal"
                    aria-valuemin={minSize}
                    aria-valuemax={maxSize}
                    aria-valuenow={header.column.getSize()}
                    aria-valuetext={`${header.column.getSize()} pixels`}
                    className={cn(
                        'absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none rounded-none border-0 bg-transparent p-0 hover:bg-border',
                        header.column.getIsResizing() ? 'bg-primary' : ''
                    )}
                    onMouseDown={header.getResizeHandler()}
                    onKeyDown={(event) => resizeHeaderFromKeyboard(event, header)}
                    onTouchStart={header.getResizeHandler()}
                />
            ) : null}
        </div>
    );
}

function ResizableTableHeadBase({ header, className = '', style }) {
    return (
        <TableHead
            className={cn('group relative select-none', className)}
            style={{
                width: resolveSize(header.getSize()),
                ...style
            }}>
            <ResizableTableHeadContent header={header} />
        </TableHead>
    );
}

function SortableResizableTableHead({ header, className = '', style }) {
    const {
        attributes,
        listeners,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: header.column.id });

    const dragHandleProps = {
        ...attributes,
        ...listeners,
        ref: setActivatorNodeRef,
        onClick: (event) => event.stopPropagation()
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
                width: resolveSize(header.getSize()),
                transform: CSS.Transform.toString(transform),
                transition,
                ...style
            }}>
            <ResizableTableHeadContent header={header} dragHandleProps={dragHandleProps} />
        </TableHead>
    );
}

export function ResizableTableHead({
    header,
    className = '',
    style,
    enableColumnReorder = false
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

    return <ResizableTableHeadBase header={header} className={className} style={style} />;
}

export function ResizableTableCell({ cell, className = '', style }) {
    return (
        <TableCell
            className={className}
            style={{
                width: resolveSize(cell.column.getSize()),
                ...style
            }}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
    );
}
