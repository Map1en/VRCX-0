import { Fragment } from 'react';
import {
    ArrowDownIcon,
    ArrowUpIcon,
    RotateCcwIcon,
    Settings2Icon
} from 'lucide-react';

import { Button } from '@/ui/shadcn/button.jsx';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';

function resolveColumnLabel(column) {
    const metaLabel = column.columnDef?.meta?.label;
    if (typeof metaLabel === 'string' && metaLabel.trim()) {
        return metaLabel;
    }
    if (typeof column.columnDef?.header === 'string' && column.columnDef.header.trim()) {
        return column.columnDef.header;
    }
    return column.id;
}

function getColumnOrder(table, leafColumns = table.getAllLeafColumns()) {
    const leafColumnIds = leafColumns.map((column) => column.id);
    const leafColumnIdSet = new Set(leafColumnIds);
    const currentOrder = table.getState().columnOrder || [];
    const ordered = currentOrder.filter((columnId) => leafColumnIdSet.has(columnId));
    const orderedIds = new Set(ordered);

    for (const columnId of leafColumnIds) {
        if (!orderedIds.has(columnId)) {
            ordered.push(columnId);
            orderedIds.add(columnId);
        }
    }

    return ordered;
}

function moveColumn(table, columnId, delta, order = getColumnOrder(table)) {
    const currentIndex = order.indexOf(columnId);
    const nextIndex = currentIndex + delta;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= order.length) {
        return;
    }

    const nextOrder = [...order];
    const [entry] = nextOrder.splice(currentIndex, 1);
    nextOrder.splice(nextIndex, 0, entry);
    table.setColumnOrder(nextOrder);
}

function resetTableLayout(table, onResetLayout) {
    if (typeof onResetLayout === 'function') {
        onResetLayout(table);
        return;
    }

    table.resetColumnVisibility();
    table.setColumnOrder([]);
    table.setColumnSizing({});
}

export function TableColumnVisibilityMenu({ table, label = 'Columns', onResetLayout }) {
    const allLeafColumns = table.getAllLeafColumns();
    const columns = allLeafColumns.filter((column) => column.getCanHide());

    if (!columns.length && !allLeafColumns.length) {
        return null;
    }

    const columnOrder = getColumnOrder(table, allLeafColumns);
    const columnOrderIndexById = new Map(
        columnOrder.map((columnId, index) => [columnId, index])
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="gap-2">
                    <Settings2Icon className="size-4" />
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
                <DropdownMenuLabel>Table layout</DropdownMenuLabel>
                <DropdownMenuItem
                    className="gap-2"
                    onSelect={(event) => {
                        event.preventDefault();
                        resetTableLayout(table, onResetLayout);
                    }}>
                    <RotateCcwIcon className="size-4" />
                    Reset columns
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {columns.map((column) => {
                    const columnIndex = columnOrderIndexById.get(column.id) ?? -1;
                    const columnLabel = resolveColumnLabel(column);
                    const canMoveUp = columnIndex > 0;
                    const canMoveDown = columnIndex >= 0 && columnIndex < columnOrder.length - 1;

                    return (
                        <Fragment key={column.id}>
                            <DropdownMenuCheckboxItem
                                className="gap-2"
                                checked={column.getIsVisible()}
                                onCheckedChange={(checked) => column.toggleVisibility(checked === true)}
                                onSelect={(event) => event.preventDefault()}>
                                <span className="min-w-0 flex-1 truncate">{columnLabel}</span>
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuItem
                                className="gap-2 pl-8 text-xs text-muted-foreground"
                                disabled={!canMoveUp}
                                onSelect={(event) => {
                                    event.preventDefault();
                                    moveColumn(table, column.id, -1, columnOrder);
                                }}>
                                <ArrowUpIcon className="size-3.5" />
                                Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="gap-2 pl-8 text-xs text-muted-foreground"
                                disabled={!canMoveDown}
                                onSelect={(event) => {
                                    event.preventDefault();
                                    moveColumn(table, column.id, 1, columnOrder);
                                }}>
                                <ArrowDownIcon className="size-3.5" />
                                Move down
                            </DropdownMenuItem>
                        </Fragment>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
