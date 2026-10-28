import type { RowData } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ToolbarViewMenu } from '@/components/layout/ToolbarControls';
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuRadioGroup,
    ContextMenuRadioItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import {
    DropdownMenuCheckboxItem,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator
} from '@/ui/shadcn/dropdown-menu';

import type { AppColumn, AppTable } from './appTable';
import {
    getAdjacentReorderableColumnId,
    getColumnOrderLocked,
    getToggleableColumns,
    hasColumnOrderLock,
    isColumnReorderable,
    isColumnToggleable,
    moveColumnTo,
    resetTableLayout,
    resolveColumnLabel,
    setColumnOrderLocked
} from './tableColumnLayout';

type ResetTableLayoutHandler<TData extends RowData> = (
    table: AppTable<TData>
) => void;

function renderColumnLockLabel(locked: boolean, t: TFunction) {
    return locked
        ? t('table.label.unlock_column_order')
        : t('table.label.lock_column_order');
}

export function TableColumnVisibilityMenu<TData extends RowData>({
    table,
    onResetLayout
}: {
    table: AppTable<TData>;
    onResetLayout?: ResetTableLayoutHandler<TData>;
}) {
    const { t } = useTranslation();

    const columns = getToggleableColumns(table.getAllLeafColumns());
    const showColumnOrderLock = hasColumnOrderLock(table);

    if (!columns.length && !showColumnOrderLock) {
        return null;
    }

    const columnOrderLocked = getColumnOrderLocked(table);

    return (
        <ToolbarViewMenu>
            <DropdownMenuGroup>
                <DropdownMenuLabel>
                    {t('table.label.table_layout')}
                </DropdownMenuLabel>
                <DropdownMenuItem
                    closeOnClick={false}
                    onClick={(event) => {
                        event.preventDefault();
                        resetTableLayout(table, onResetLayout);
                    }}
                >
                    {t('table.action.reset_columns')}
                </DropdownMenuItem>
                {showColumnOrderLock ? (
                    <DropdownMenuItem
                        closeOnClick={false}
                        onClick={(event) => {
                            event.preventDefault();
                            setColumnOrderLocked(table, !columnOrderLocked);
                        }}
                    >
                        {renderColumnLockLabel(columnOrderLocked, t)}
                    </DropdownMenuItem>
                ) : null}
            </DropdownMenuGroup>
            {columns.length ? (
                <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>
                            {t('table.label.columns')}
                        </DropdownMenuLabel>
                        {columns.map((column) => (
                            <DropdownMenuCheckboxItem
                                key={column.id}
                                checked={column.getIsVisible()}
                                onCheckedChange={(checked) =>
                                    column.toggleVisibility(checked === true)
                                }
                                onClick={(event) => event.preventDefault()}
                            >
                                <span className="min-w-0 flex-1 truncate">
                                    {resolveColumnLabel(column)}
                                </span>
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuGroup>
                </>
            ) : null}
        </ToolbarViewMenu>
    );
}

function TableLayoutContextMenuItems<TData extends RowData>({
    table,
    onResetLayout
}: {
    table: AppTable<TData>;
    onResetLayout?: ResetTableLayoutHandler<TData>;
}) {
    const { t } = useTranslation();

    const columns = getToggleableColumns(table.getAllLeafColumns());
    const columnOrderLocked = getColumnOrderLocked(table);
    const showColumnOrderLock = hasColumnOrderLock(table);

    return (
        <>
            {columns.length ? (
                <>
                    <ContextMenuGroup>
                        {columns.map((column) => (
                            <ContextMenuCheckboxItem
                                key={column.id}
                                checked={column.getIsVisible()}
                                onCheckedChange={(checked) =>
                                    column.toggleVisibility(checked === true)
                                }
                                onClick={(event) => event.preventDefault()}
                            >
                                <span className="min-w-0 flex-1 truncate">
                                    {resolveColumnLabel(column)}
                                </span>
                            </ContextMenuCheckboxItem>
                        ))}
                    </ContextMenuGroup>
                    <ContextMenuSeparator />
                </>
            ) : null}
            <ContextMenuGroup>
                {showColumnOrderLock ? (
                    <ContextMenuCheckboxItem
                        checked={columnOrderLocked}
                        onCheckedChange={(checked) =>
                            setColumnOrderLocked(table, checked === true)
                        }
                        onClick={(event) => event.preventDefault()}
                    >
                        {renderColumnLockLabel(columnOrderLocked, t)}
                    </ContextMenuCheckboxItem>
                ) : null}
                <ContextMenuItem
                    inset={showColumnOrderLock}
                    onClick={() => resetTableLayout(table, onResetLayout)}
                >
                    {t('table.action.reset_columns')}
                </ContextMenuItem>
            </ContextMenuGroup>
        </>
    );
}

export function TableColumnHeaderContextMenu<TData extends RowData>({
    table,
    onResetLayout,
    children,
    className = 'w-56'
}: {
    table: AppTable<TData>;
    onResetLayout?: ResetTableLayoutHandler<TData>;
    children: ReactElement;
    className?: string;
}) {
    return (
        <ContextMenu>
            <ContextMenuTrigger render={children} />
            <ContextMenuContent className={className}>
                <TableLayoutContextMenuItems
                    table={table}
                    onResetLayout={onResetLayout}
                />
            </ContextMenuContent>
        </ContextMenu>
    );
}

function ColumnContextMenuItems<TData extends RowData>({
    column,
    table,
    enableColumnReorder
}: {
    column: AppColumn<TData>;
    table: AppTable<TData>;
    enableColumnReorder: boolean;
}) {
    const { t } = useTranslation();
    const canSort = column.getCanSort();
    const sorted = column.getIsSorted();
    const canHide = isColumnToggleable(column);
    const canMove = enableColumnReorder && isColumnReorderable(column);
    const orderLocked = getColumnOrderLocked(table);
    const previousColumnId = canMove
        ? getAdjacentReorderableColumnId(table, column.id, -1)
        : null;
    const nextColumnId = canMove
        ? getAdjacentReorderableColumnId(table, column.id, 1)
        : null;

    if (!canSort && !canHide && !canMove) {
        return null;
    }

    return (
        <>
            {canSort ? (
                <ContextMenuGroup>
                    <ContextMenuRadioGroup
                        value={sorted || ''}
                        onValueChange={(value) =>
                            column.toggleSorting(value === 'desc')
                        }
                    >
                        <ContextMenuRadioItem value="asc">
                            {t('table.action.sort_ascending')}
                        </ContextMenuRadioItem>
                        <ContextMenuRadioItem value="desc">
                            {t('table.action.sort_descending')}
                        </ContextMenuRadioItem>
                    </ContextMenuRadioGroup>
                    <ContextMenuItem
                        inset
                        disabled={!sorted}
                        onClick={() => column.clearSorting()}
                    >
                        {t('table.action.clear_sort')}
                    </ContextMenuItem>
                </ContextMenuGroup>
            ) : null}
            {canSort && (canHide || canMove) ? <ContextMenuSeparator /> : null}
            {canHide || canMove ? (
                <ContextMenuGroup>
                    {canMove ? (
                        <>
                            <ContextMenuItem
                                disabled={orderLocked || !previousColumnId}
                                onClick={() => {
                                    if (previousColumnId) {
                                        moveColumnTo(
                                            table,
                                            column.id,
                                            previousColumnId
                                        );
                                    }
                                }}
                            >
                                {t('table.action.move_column_left')}
                            </ContextMenuItem>
                            <ContextMenuItem
                                disabled={orderLocked || !nextColumnId}
                                onClick={() => {
                                    if (nextColumnId) {
                                        moveColumnTo(
                                            table,
                                            column.id,
                                            nextColumnId
                                        );
                                    }
                                }}
                            >
                                {t('table.action.move_column_right')}
                            </ContextMenuItem>
                        </>
                    ) : null}
                    {canHide ? (
                        <ContextMenuItem
                            onClick={() => column.toggleVisibility(false)}
                        >
                            {t('table.action.hide_column')}
                        </ContextMenuItem>
                    ) : null}
                </ContextMenuGroup>
            ) : null}
            <ContextMenuSeparator />
        </>
    );
}

export function TableColumnContextMenu<TData extends RowData>({
    column,
    table,
    enableColumnReorder,
    onResetLayout,
    children
}: {
    column: AppColumn<TData>;
    table: AppTable<TData>;
    enableColumnReorder: boolean;
    onResetLayout?: ResetTableLayoutHandler<TData>;
    children: ReactElement;
}) {
    return (
        <ContextMenu>
            <ContextMenuTrigger render={children} />
            <ContextMenuContent className="w-56">
                <ColumnContextMenuItems
                    column={column}
                    table={table}
                    enableColumnReorder={enableColumnReorder}
                />
                <TableLayoutContextMenuItems
                    table={table}
                    onResetLayout={onResetLayout}
                />
            </ContextMenuContent>
        </ContextMenu>
    );
}
