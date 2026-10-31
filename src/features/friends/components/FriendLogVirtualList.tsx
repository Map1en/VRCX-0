import { useMemo, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
import {
    getColumnGridLayout,
    getColumnSizeVars
} from '@/components/data-table/columnSizing';
import { DataTableColumnResizeHandle } from '@/components/data-table/DataTableColumnResizeHandle';
import {
    LogFilterContextMenu,
    getLogFilterRowAttributes,
    type LogFilterCommands
} from '@/components/data-table/LogFilterContextMenu';
import { getColumnOrderLocked } from '@/components/data-table/tableColumnLayout';
import { TableColumnContextMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { VirtualHistoryList } from '@/components/data-table/VirtualHistoryList';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { getFriendLogRowKey, type FriendLogRow } from '../friendLogRows';
import { FriendLogDateCell, FriendLogDeleteAction } from './FriendLogColumns';
import { FriendLogTypeIndicator, renderUserCell } from './FriendLogViewParts';

export function FriendLogVirtualList({
    rows,
    table,
    filterCommands,
    resolveDisplayName,
    deleteAction,
    resetKey,
    hasMore,
    loadingOlder,
    loadOlderFailed,
    hasUnloadedLatest,
    onLoadOlder,
    onReloadLatest,
    onViewingLatestChange
}: {
    rows: FriendLogRow[];
    table: AppTable<FriendLogRow>;
    filterCommands: LogFilterCommands;
    resolveDisplayName(row: FriendLogRow): string;
    deleteAction: Omit<ComponentProps<typeof FriendLogDeleteAction>, 'row'>;
    resetKey: string;
    hasMore: boolean;
    loadingOlder: boolean;
    loadOlderFailed: boolean;
    hasUnloadedLatest: boolean;
    onLoadOlder(): void;
    onReloadLatest(): void;
    onViewingLatestChange(value: boolean): void;
}) {
    const { t } = useTranslation();
    const density = usePreferencesStore((state) => state.tableDensity);
    const entries = useMemo(
        () =>
            rows.map((row) => ({
                key: getFriendLogRowKey(row, deleteAction.rowsOwnerUserId),
                row
            })),
        [rows, deleteAction.rowsOwnerUserId]
    );
    const headers = table.getHeaderGroups().flatMap((group) => group.headers);
    const columns = table.getVisibleLeafColumns();
    const layout = getColumnGridLayout(columns, 'displayName');
    const labels: Record<string, string> = {
        created_at: t('table.friendLog.date'),
        type: t('table.friendLog.type'),
        displayName: t('table.friendLog.user'),
        action: t('table.friendLog.action')
    };

    const footer = loadOlderFailed ? (
        <div role="status" className="flex items-center gap-2">
            {t('view.friend_log.load_older_failed')}
            <Button variant="link" size="sm" onClick={onLoadOlder}>
                {t('common.action.retry')}
            </Button>
        </div>
    ) : loadingOlder ? (
        <>
            <Spinner data-icon="inline-start" className="mr-2" />
            {t('common.load_more')}...
        </>
    ) : hasMore ? (
        <Button variant="link" size="sm" onClick={onLoadOlder}>
            {t('common.load_more')}
        </Button>
    ) : (
        <span>
            {rows.length} {t('view.friend_log.rows')} · {t('common.no_more')}
        </span>
    );

    return (
        <LogFilterContextMenu commands={filterCommands}>
            <div className="flex min-h-0 flex-1 flex-col">
                <VirtualHistoryList
                    rows={entries}
                    estimatedRowHeight={density === 'compact' ? 32 : 40}
                    resetKey={resetKey}
                    minWidth={layout.minWidth}
                    sizingStyle={getColumnSizeVars(columns)}
                    hasMore={hasMore && !loadOlderFailed}
                    loadingOlder={loadingOlder}
                    onLoadOlder={onLoadOlder}
                    hasUnloadedLatest={hasUnloadedLatest}
                    onReloadLatest={onReloadLatest}
                    onViewingLatestChange={onViewingLatestChange}
                    latestLabel={t('view.friend_log.latest')}
                    header={
                        <div
                            className="grid min-h-[var(--vrcx-0-table-header-height)] items-center text-xs text-[var(--vrcx-0-table-header-foreground)]"
                            style={layout}
                        >
                            {headers.map((header) => (
                                <TableColumnContextMenu
                                    key={header.id}
                                    column={header.column}
                                    table={table}
                                    enableColumnReorder={
                                        !getColumnOrderLocked(table)
                                    }
                                >
                                    <div className="relative flex h-full min-w-0 items-center px-[var(--vrcx-0-table-cell-padding-inline)]">
                                        <span className="truncate">
                                            {labels[header.column.id]}
                                        </span>
                                        {header.column.getCanResize() ? (
                                            <DataTableColumnResizeHandle
                                                header={header}
                                                label={
                                                    labels[header.column.id] ??
                                                    ''
                                                }
                                            />
                                        ) : null}
                                    </div>
                                </TableColumnContextMenu>
                            ))}
                        </div>
                    }
                    renderRow={({ row }) => (
                        <div
                            data-friend-history-row=""
                            {...getLogFilterRowAttributes({
                                userId: row.userId || '',
                                userName: resolveDisplayName(row),
                                type: row.type,
                                typeLabel: t(
                                    `view.friend_log.filters.${row.type}`
                                )
                            })}
                            className="grid h-[var(--vrcx-0-table-row-height)] items-center border-b border-[var(--vrcx-0-table-divider)] hover:bg-[var(--vrcx-0-table-row-hover-surface)]"
                            style={layout}
                        >
                            {columns.map((column) => (
                                <div
                                    key={column.id}
                                    className="min-w-0 truncate px-[var(--vrcx-0-table-cell-padding-inline)]"
                                >
                                    {column.id === 'created_at' ? (
                                        <FriendLogDateCell row={row} />
                                    ) : column.id === 'type' ? (
                                        <FriendLogTypeIndicator
                                            type={row.type}
                                        />
                                    ) : column.id === 'displayName' ? (
                                        renderUserCell({
                                            ...row,
                                            resolvedDisplayName:
                                                resolveDisplayName(row)
                                        })
                                    ) : column.id === 'action' ? (
                                        <FriendLogDeleteAction
                                            {...deleteAction}
                                            row={row}
                                        />
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    )}
                    footer={footer}
                    emptyState={footer}
                />
            </div>
        </LogFilterContextMenu>
    );
}
