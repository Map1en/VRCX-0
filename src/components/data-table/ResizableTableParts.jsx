import { flexRender } from '@tanstack/react-table';

import { cn } from '@/lib/utils.js';
import { TableCell, TableHead } from '@/ui/shadcn/table.jsx';

function resolveSize(value) {
    const size = Number(value);
    return Number.isFinite(size) && size > 0 ? `${size}px` : undefined;
}

export function ResizableTableHead({ header, className = '', style }) {
    const canResize = header.column.getCanResize();

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
                    <button
                        type="button"
                        aria-label={`Resize ${header.column.id}`}
                        className={cn(
                            'absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none bg-transparent hover:bg-border',
                            header.column.getIsResizing() ? 'bg-primary' : ''
                        )}
                        onMouseDown={header.getResizeHandler()}
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
