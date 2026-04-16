import { flexRender } from '@tanstack/react-table';

import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';
import { TableCell, TableHead } from '@/ui/shadcn/table';

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

export function ResizableTableHead({ header, className = '', style }) {
    const canResize = header.column.getCanResize();
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;

    return (
        <TableHead
            className={cn('relative select-none', className)}
            style={{
                width: resolveSize(header.getSize()),
                ...style
            }}>
            <div className="flex min-w-0 items-center gap-2 pr-2">
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
        </TableHead>
    );
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
