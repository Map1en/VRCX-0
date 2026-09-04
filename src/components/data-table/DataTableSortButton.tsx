import type { RowData } from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { AppColumn } from '@/components/data-table/appTable';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';

type SortDirection = 'asc' | 'desc' | false;

function normalizeDirection(value: SortDirection | undefined): SortDirection {
    return value === 'asc' || value === 'desc' ? value : false;
}

function nextSortDirection(
    direction: SortDirection,
    descFirst: boolean
): SortDirection {
    if (!direction) {
        return descFirst ? 'desc' : 'asc';
    }
    if (direction === 'asc') {
        return descFirst ? false : 'desc';
    }
    return descFirst ? 'asc' : false;
}

export function DataTableSortButton<TData extends RowData>({
    active = undefined,
    className = '',
    column = null,
    descFirst = false,
    direction = undefined,
    label,
    labelClassName = '',
    onSort = undefined
}: {
    active?: boolean;
    className?: string;
    column?: AppColumn<TData> | null;
    descFirst?: boolean;
    direction?: SortDirection;
    label: ReactNode;
    labelClassName?: string;
    onSort?: (
        nextDirection: SortDirection,
        currentDirection: SortDirection
    ) => void;
}) {
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
                'text-muted-foreground hover:text-foreground h-auto min-w-0 justify-start gap-1 p-0 text-left text-xs font-medium',
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

export function DataTableHeaderLabel({
    children,
    className = ''
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'text-muted-foreground text-xs font-medium',
                className
            )}
        >
            {children}
        </span>
    );
}
