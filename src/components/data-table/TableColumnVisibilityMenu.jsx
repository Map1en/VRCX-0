import {
    ArrowDownIcon,
    ArrowUpIcon,
    LockIcon,
    RotateCcwIcon,
    Settings2Icon,
    UnlockIcon
} from 'lucide-react';
import { Fragment } from 'react';

import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';

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
import {
    getColumnOrder,
    getColumnOrderLocked,
    getToggleableColumns,
    hasColumnOrderLock,
    resetTableLayout,
    resolveColumnLabel,
    setColumnOrderLocked
} from './tableColumnLayout.js';

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

function renderColumnLockLabel(locked) {
    return locked ? 'Unlock column order' : 'Lock column order';
}

export function TableColumnVisibilityMenu({
    table,
    label = 'Columns',
    onResetLayout
}) {
    const { t } = useTranslation();

    const allLeafColumns = table.getAllLeafColumns();
    const columns = getToggleableColumns(allLeafColumns);

    if (!columns.length && !allLeafColumns.length) {
        return null;
    }

    const columnOrder = getColumnOrder(table, allLeafColumns);
    const columnOrderLocked = getColumnOrderLocked(table);
    const showColumnOrderLock = hasColumnOrderLock(table);
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
            <DropdownMenuContent
                align="end"
                className="max-h-96 w-72 overflow-y-auto"
            >
                <DropdownMenuLabel>{t('table.generated.table_layout')}</DropdownMenuLabel>
                <DropdownMenuGroup>
                    <DropdownMenuItem
                        onSelect={(event) => {
                            event.preventDefault();
                            resetTableLayout(table, onResetLayout);
                        }}
                    >
                        <RotateCcwIcon data-icon="inline-start" />
                        {t('table.generated.reset_columns')}
                    </DropdownMenuItem>
                    {showColumnOrderLock ? (
                        <DropdownMenuItem
                            onSelect={(event) => {
                                event.preventDefault();
                                setColumnOrderLocked(table, !columnOrderLocked);
                            }}
                        >
                            {columnOrderLocked ? (
                                <UnlockIcon data-icon="inline-start" />
                            ) : (
                                <LockIcon data-icon="inline-start" />
                            )}
                            {renderColumnLockLabel(columnOrderLocked)}
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {columns.map((column) => {
                        const columnIndex =
                            columnOrderIndexById.get(column.id) ?? -1;
                        const columnLabel = resolveColumnLabel(column);
                        const canMoveUp = columnIndex > 0;
                        const canMoveDown =
                            columnIndex >= 0 &&
                            columnIndex < columnOrder.length - 1;

                        return (
                            <Fragment key={column.id}>
                                <DropdownMenuCheckboxItem
                                    checked={column.getIsVisible()}
                                    onCheckedChange={(checked) =>
                                        column.toggleVisibility(
                                            checked === true
                                        )
                                    }
                                    onSelect={(event) => event.preventDefault()}
                                >
                                    <span className="min-w-0 flex-1 truncate">
                                        {columnLabel}
                                    </span>
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuItem
                                    inset
                                    disabled={columnOrderLocked || !canMoveUp}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        moveColumn(
                                            table,
                                            column.id,
                                            -1,
                                            columnOrder
                                        );
                                    }}
                                >
                                    <ArrowUpIcon data-icon="inline-start" />
                                    {t('table.generated.move_up')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    inset
                                    disabled={columnOrderLocked || !canMoveDown}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        moveColumn(
                                            table,
                                            column.id,
                                            1,
                                            columnOrder
                                        );
                                    }}
                                >
                                    <ArrowDownIcon data-icon="inline-start" />
                                    {t('table.generated.move_down')}
                                </DropdownMenuItem>
                            </Fragment>
                        );
                    })}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function TableColumnHeaderContextMenu({
    table,
    onResetLayout,
    children,
    className = 'w-56'
}) {
    const { t } = useTranslation();

    const allLeafColumns = table?.getAllLeafColumns?.() ?? [];
    const columns = getToggleableColumns(allLeafColumns);
    const columnOrderLocked = getColumnOrderLocked(table);
    const showColumnOrderLock = hasColumnOrderLock(table);
    const showReset = Boolean(
        onResetLayout ||
        table?.resetColumnVisibility ||
        table?.setColumnOrder ||
        table?.setColumnSizing
    );
    const showMenu = Boolean(
        columns.length || showColumnOrderLock || showReset
    );

    if (!showMenu) {
        return children;
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent className={className}>
                {columns.length ? (
                    <ContextMenuGroup>
                        {columns.map((column) => (
                            <ContextMenuCheckboxItem
                                key={column.id}
                                checked={column.getIsVisible()}
                                onCheckedChange={(checked) =>
                                    column.toggleVisibility(checked === true)
                                }
                                onSelect={(event) => event.preventDefault()}
                            >
                                <span className="min-w-0 flex-1 truncate">
                                    {resolveColumnLabel(column)}
                                </span>
                            </ContextMenuCheckboxItem>
                        ))}
                    </ContextMenuGroup>
                ) : null}
                {columns.length && (showColumnOrderLock || showReset) ? (
                    <ContextMenuSeparator />
                ) : null}
                {showColumnOrderLock || showReset ? (
                    <ContextMenuGroup>
                        {showColumnOrderLock ? (
                            <ContextMenuCheckboxItem
                                checked={columnOrderLocked}
                                onCheckedChange={(checked) =>
                                    setColumnOrderLocked(
                                        table,
                                        checked === true
                                    )
                                }
                                onSelect={(event) => event.preventDefault()}
                            >
                                {renderColumnLockLabel(columnOrderLocked)}
                            </ContextMenuCheckboxItem>
                        ) : null}
                        {showReset ? (
                            <ContextMenuItem
                                inset={showColumnOrderLock}
                                onSelect={() =>
                                    resetTableLayout(table, onResetLayout)
                                }
                            >
                                {t('table.generated.reset_columns')}
                            </ContextMenuItem>
                        ) : null}
                    </ContextMenuGroup>
                ) : null}
            </ContextMenuContent>
        </ContextMenu>
    );
}
