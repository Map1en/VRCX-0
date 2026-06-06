import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';

function normalizeDirection(value: any) {
    return value === 'asc' || value === 'desc' ? value : false;
}

function nextSortDirection(direction: any, descFirst: any) {
    if (!direction) {
        return descFirst ? 'desc' : 'asc';
    }
    if (direction === 'asc') {
        return descFirst ? false : 'desc';
    }
    return descFirst ? 'asc' : false;
}

export function DataTableSortButton({
    active = undefined,
    className = '',
    column = null,
    descFirst = false,
    direction = undefined,
    label,
    labelClassName = '',
    onSort = null
}: any) {
    const columnDirection = normalizeDirection(column?.getIsSorted?.());
    const controlledDirection =
        active === false ? false : normalizeDirection(direction);
    const currentDirection = column ? columnDirection : controlledDirection;

    function handleSort() {
        const nextDirection = nextSortDirection(currentDirection, descFirst);
        if (column) {
            if (nextDirection === 'asc') {
                column.toggleSorting(false);
            } else if (nextDirection === 'desc') {
                column.toggleSorting(true);
            } else {
                column.clearSorting();
            }
        }
        onSort?.(nextDirection, currentDirection);
    }

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
                'text-muted-foreground hover:text-foreground h-auto min-w-0 justify-start gap-1 p-0 text-left text-xs font-medium tracking-wide uppercase',
                className
            )}
            onClick={handleSort}
        >
            <span className={cn('min-w-0 truncate', labelClassName)}>
                {label}
            </span>
            {currentDirection === 'asc' ? (
                <ArrowUpIcon data-icon="inline-end" />
            ) : currentDirection === 'desc' ? (
                <ArrowDownIcon data-icon="inline-end" />
            ) : (
                <ArrowUpDownIcon
                    data-icon="inline-end"
                    className="text-muted-foreground opacity-70"
                />
            )}
        </Button>
    );
}
