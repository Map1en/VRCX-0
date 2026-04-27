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
} from './tableColumnLayout.js';

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
    const showColumnOrderLock = hasColumnOrderLock(table);

    if (!columns.length && !showColumnOrderLock) {
        return null;
    }

    const columnOrderLocked = getColumnOrderLocked(table);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={label}
                >
                    <Settings2Icon data-icon="icon" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="max-h-96 w-72 overflow-y-auto"
            >
                <DropdownMenuLabel>
                    {t('table.generated.table_layout')}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                    <DropdownMenuItem
                        onSelect={(event) => {
                            event.preventDefault();
                            resetTableLayout(table, onResetLayout);
                        }}
                    >
                        {t('table.generated.reset_columns')}
                    </DropdownMenuItem>
                    {showColumnOrderLock ? (
                        <DropdownMenuItem
                            onSelect={(event) => {
                                event.preventDefault();
                                setColumnOrderLocked(table, !columnOrderLocked);
                            }}
                        >
                            {renderColumnLockLabel(columnOrderLocked)}
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
                                    onSelect={(event) =>
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
