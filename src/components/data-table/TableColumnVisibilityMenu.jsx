import { Fragment } from 'react';
import {
    ArrowDownIcon,
    ArrowUpIcon,
    RotateCcwIcon,
    Settings2Icon
} from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

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
                <Button type="button" variant="outline" size="sm">
                    <Settings2Icon data-icon="inline-start" />
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
                <DropdownMenuLabel>Table layout</DropdownMenuLabel>
                <DropdownMenuGroup>
                    <DropdownMenuItem
                        onSelect={(event) => {
                            event.preventDefault();
                            resetTableLayout(table, onResetLayout);
                        }}>
                        <RotateCcwIcon data-icon="inline-start" />
                        Reset columns
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {columns.map((column) => {
                        const columnIndex = columnOrderIndexById.get(column.id) ?? -1;
                        const columnLabel = resolveColumnLabel(column);
                        const canMoveUp = columnIndex > 0;
                        const canMoveDown = columnIndex >= 0 && columnIndex < columnOrder.length - 1;

                        return (
                            <Fragment key={column.id}>
                                <DropdownMenuCheckboxItem
                                    checked={column.getIsVisible()}
                                    onCheckedChange={(checked) => column.toggleVisibility(checked === true)}
                                    onSelect={(event) => event.preventDefault()}>
                                    <span className="min-w-0 flex-1 truncate">{columnLabel}</span>
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuItem
                                    inset
                                    disabled={!canMoveUp}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        moveColumn(table, column.id, -1, columnOrder);
                                    }}>
                                    <ArrowUpIcon data-icon="inline-start" />
                                    Move up
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    inset
                                    disabled={!canMoveDown}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        moveColumn(table, column.id, 1, columnOrder);
                                    }}>
                                    <ArrowDownIcon data-icon="inline-start" />
                                    Move down
                                </DropdownMenuItem>
                            </Fragment>
                        );
                    })}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
