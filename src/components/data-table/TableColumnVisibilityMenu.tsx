import { Settings2Icon } from 'lucide-react';
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

function renderColumnLockLabel(locked: any, t: any) {
    return locked
        ? t('table.label.unlock_column_order')
        : t('table.label.lock_column_order');
}

export function TableColumnVisibilityMenu({
    table,
    label,
    onResetLayout
}: any) {
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
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={resolvedLabel}
                >
                    <Settings2Icon data-icon="icon" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="max-h-96 w-72 overflow-y-auto"
            >
                <DropdownMenuLabel>
                    {t('table.label.table_layout')}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                    <DropdownMenuItem
                        onSelect={(event: any) => {
                            event.preventDefault();
                            resetTableLayout(table, onResetLayout);
                        }}
                    >
                        {t('table.action.reset_columns')}
                    </DropdownMenuItem>
                    {showColumnOrderLock ? (
                        <DropdownMenuItem
                            onSelect={(event: any) => {
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
                            {columns.map((column: any) => (
                                <DropdownMenuCheckboxItem
                                    key={column.id}
                                    checked={column.getIsVisible()}
                                    onCheckedChange={(checked: any) =>
                                        column.toggleVisibility(
                                            checked === true
                                        )
                                    }
                                    onSelect={(event: any) =>
                                        event.preventDefault()
                                    }
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

export function TableColumnHeaderContextMenu({
    table,
    onResetLayout,
    children,
    className = 'w-56'
}: any) {
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
                        {columns.map((column: any) => (
                            <ContextMenuCheckboxItem
                                key={column.id}
                                checked={column.getIsVisible()}
                                onCheckedChange={(checked: any) =>
                                    column.toggleVisibility(checked === true)
                                }
                                onSelect={(event: any) =>
                                    event.preventDefault()
                                }
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
                                onCheckedChange={(checked: any) =>
                                    setColumnOrderLocked(
                                        table,
                                        checked === true
                                    )
                                }
                                onSelect={(event: any) =>
                                    event.preventDefault()
                                }
                            >
                                {renderColumnLockLabel(columnOrderLocked, t)}
                            </ContextMenuCheckboxItem>
                        ) : null}
                        {showReset ? (
                            <ContextMenuItem
                                inset={showColumnOrderLock}
                                onSelect={() =>
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
