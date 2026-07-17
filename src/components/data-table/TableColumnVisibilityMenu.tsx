import type { RowData, Table } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { Settings2Icon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
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
    getColumnOrderLocked,
    getToggleableColumns,
    hasColumnOrderLock,
    resetTableLayout,
    resolveColumnLabel,
    setColumnOrderLocked
} from './tableColumnLayout';

type ResetTableLayoutHandler<TData extends RowData> = (
    table: Table<TData>
) => void;

function renderColumnLockLabel(locked: boolean, t: TFunction) {
    return locked
        ? t('table.label.unlock_column_order')
        : t('table.label.lock_column_order');
}

export function TableColumnVisibilityMenu<TData extends RowData>({
    table,
    label,
    onResetLayout,
    size = 'icon-lg',
    variant = 'ghost'
}: {
    table: Table<TData>;
    label?: string;
    onResetLayout?: ResetTableLayoutHandler<TData>;
    size?: React.ComponentProps<typeof Button>['size'];
    variant?: React.ComponentProps<typeof Button>['variant'];
}) {
    const { t } = useTranslation();

    const allLeafColumns = table.getAllLeafColumns();
    const columns = getToggleableColumns(allLeafColumns);
    const showColumnOrderLock = hasColumnOrderLock(table);

    if (!columns.length && !showColumnOrderLock) {
        return null;
    }

    const columnOrderLocked = getColumnOrderLocked(table);
    const resolvedLabel = label || t('table.label.columns');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant={variant}
                        size={size}
                        aria-label={resolvedLabel}
                    >
                        <Settings2Icon data-icon="icon" />
                    </Button>
                }
            />
            <DropdownMenuContent
                align="end"
                className="max-h-96 w-72 overflow-y-auto"
            >
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
                            {columns.map((column) => (
                                <DropdownMenuCheckboxItem
                                    key={column.id}
                                    checked={column.getIsVisible()}
                                    onCheckedChange={(checked) =>
                                        column.toggleVisibility(
                                            checked === true
                                        )
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
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function TableColumnHeaderContextMenu<TData extends RowData>({
    table,
    onResetLayout,
    children,
    className = 'w-56'
}: {
    table: Table<TData>;
    onResetLayout?: ResetTableLayoutHandler<TData>;
    children: ReactNode;
    className?: string;
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
            <ContextMenuTrigger render={children as ReactElement} />
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
                                onClick={(event) => event.preventDefault()}
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
                                onClick={(event) => event.preventDefault()}
                            >
                                {renderColumnLockLabel(columnOrderLocked, t)}
                            </ContextMenuCheckboxItem>
                        ) : null}
                        {showReset ? (
                            <ContextMenuItem
                                inset={showColumnOrderLock}
                                onClick={() =>
                                    resetTableLayout(table, onResetLayout)
                                }
                            >
                                {t('table.action.reset_columns')}
                            </ContextMenuItem>
                        ) : null}
                    </ContextMenuGroup>
                ) : null}
            </ContextMenuContent>
        </ContextMenu>
    );
}
