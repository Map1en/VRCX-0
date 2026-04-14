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

function getColumnOrder(table) {
    const leafColumnIds = table.getAllLeafColumns().map((column) => column.id);
    const currentOrder = table.getState().columnOrder || [];
    const ordered = currentOrder.filter((columnId) => leafColumnIds.includes(columnId));

    for (const columnId of leafColumnIds) {
        if (!ordered.includes(columnId)) {
            ordered.push(columnId);
        }
    }

    return ordered;
}

function moveColumn(table, columnId, delta) {
    const order = getColumnOrder(table);
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
    const columns = table
        .getAllLeafColumns()
        .filter((column) => column.getCanHide());

    if (!columns.length && !table.getAllLeafColumns().length) {
        return null;
    }

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
                {columns.map((column) => (
                    <DropdownMenuCheckboxItem
                        key={column.id}
                        className="gap-2"
                        checked={column.getIsVisible()}
                        onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
                        onSelect={(event) => event.preventDefault()}>
                        <span className="min-w-0 flex-1 truncate">{resolveColumnLabel(column)}</span>
                        <span className="ml-auto flex items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                disabled={getColumnOrder(table).indexOf(column.id) <= 0}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    moveColumn(table, column.id, -1);
                                }}>
                                <ArrowUpIcon className="size-3.5" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                disabled={
                                    getColumnOrder(table).indexOf(column.id) >=
                                    getColumnOrder(table).length - 1
                                }
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    moveColumn(table, column.id, 1);
                                }}>
                                <ArrowDownIcon className="size-3.5" />
                            </Button>
                        </span>
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
