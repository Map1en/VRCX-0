import { ChevronRightIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    type ColumnGridLayout,
    getColumnGridLayout,
    getColumnSizeVars
} from '@/components/data-table/columnSizing';
import { DataTableColumnResizeHandle } from '@/components/data-table/DataTableColumnResizeHandle';
import { DataTableHeaderLabel } from '@/components/data-table/DataTableSortButton';
import {
    LogFilterContextMenu,
    getLogFilterRowAttributes,
    type LogFilterCommands
} from '@/components/data-table/LogFilterContextMenu';
import { TableColumnContextMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { TimestampText } from '@/components/data-table/TimestampText';
import { VirtualHistoryList } from '@/components/data-table/VirtualHistoryList';
import { FeedDetailCell } from '@/components/feed/FeedDetailCell';
import {
    canExpandFeedRow,
    getFeedRowId,
    resolveFeedUserId
} from '@/components/feed/feedRows';
import { FeedTypeIndicator } from '@/components/feed/FeedTypeIndicator';
import type {
    FeedFriendActions,
    FeedLoadStatus,
    FeedLocationActionPayload,
    FeedRow,
    FeedTableInstance
} from '@/components/feed/feedTypes';
import { cn } from '@/lib/utils';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { getFeedRowFilterTarget } from '../feedRowFilterTarget';
import { useFeedNewTopRowKeys } from '../useFeedNewTopRowKeys';
import { FeedEmptyState, type FeedEmptyFilterModel } from './FeedEmptyState';
import { FeedExpandedRow, FeedUserLink } from './FeedTableParts';

type FeedVirtualListShellProps = {
    actions: FeedFriendActions;
    emptyFilterModel: FeedEmptyFilterModel;
    filterCommands: LogFilterCommands;
    favoritesOnly: boolean;
    friendLogNamesById: Record<string, string>;
    hasMore: boolean;
    hasUnloadedLatest: boolean;
    isFavoritesLoaded: boolean;
    loadStatus: FeedLoadStatus;
    loadingOlder: boolean;
    loadingPreviousInstancesKey: string;
    newCount?: number;
    onLoadOlder(): void;
    onReloadLatest(): void;
    onOpenPreviousInstances(payload?: FeedLocationActionPayload): void;
    onViewingLatestChange(value: boolean): void;
    resetKey: string;
    rows: FeedRow[];
    sourceRows: FeedRow[];
    table: FeedTableInstance;
};

type FeedVirtualRow = {
    key: string;
    row: FeedRow;
};

type FeedListLayout = ColumnGridLayout;

const FEED_LIST_COLUMN_IDS = [
    'expander',
    'created_at',
    'displayName',
    'type',
    'detail'
] as const;

function getFeedListColumns(table: FeedTableInstance) {
    return FEED_LIST_COLUMN_IDS.flatMap((id) => {
        const column = table.getColumn(id);
        return column ? [column] : [];
    });
}

function FeedListHeader({
    layout,
    table
}: {
    layout: FeedListLayout;
    table: FeedTableInstance;
}) {
    const { t } = useTranslation();
    const headers = table.getHeaderGroups().flatMap((group) => group.headers);
    const definitions = [
        { id: 'created_at', label: t('table.feed.date') },
        { id: 'displayName', label: t('table.feed.user') },
        { id: 'type', label: t('table.feed.type') },
        { id: 'detail', label: t('table.feed.detail') }
    ];
    return (
        <div
            className="grid h-[var(--vrcx-0-table-header-height)] items-center"
            style={layout}
        >
            <span aria-hidden="true" />
            {definitions.map(({ id, label }) => {
                const header = headers.find((entry) => entry.column.id === id);
                const cell = (
                    <div className="relative flex h-full min-w-0 items-center px-[var(--vrcx-0-table-cell-padding-inline)]">
                        <DataTableHeaderLabel className="min-w-0 truncate">
                            {label}
                        </DataTableHeaderLabel>
                        {header ? (
                            <DataTableColumnResizeHandle
                                header={header}
                                label={label}
                            />
                        ) : null}
                    </div>
                );
                return header ? (
                    <TableColumnContextMenu
                        key={id}
                        column={header.column}
                        table={table}
                        enableColumnReorder={false}
                    >
                        {cell}
                    </TableColumnContextMenu>
                ) : (
                    <Fragment key={id}>{cell}</Fragment>
                );
            })}
        </div>
    );
}

function FeedListTime({ row }: { row: FeedRow }) {
    return (
        <TimestampText
            value={row.created_at}
            tooltipSide="right"
            className="text-muted-foreground text-sm tabular-nums"
        />
    );
}

function FeedVirtualListRow({
    actions,
    cachedDisplayName,
    expanded,
    layout,
    filterCommands,
    loadingPreviousInstancesKey,
    onOpenPreviousInstances,
    onToggle,
    row
}: {
    actions: FeedFriendActions;
    cachedDisplayName: string;
    expanded: boolean;
    filterCommands: LogFilterCommands;
    layout: FeedListLayout;
    loadingPreviousInstancesKey: string;
    onOpenPreviousInstances(payload?: FeedLocationActionPayload): void;
    onToggle(): void;
    row: FeedRow;
}) {
    const { t } = useTranslation();
    const canExpand = canExpandFeedRow(row);
    const typeLabel = row.type ? t(`view.feed.filters.${row.type}`) : '';

    return (
        <div
            className={
                expanded
                    ? 'bg-[var(--vrcx-0-table-row-expanded-surface)]'
                    : undefined
            }
        >
            <div
                data-feed-list-summary=""
                {...getLogFilterRowAttributes(
                    getFeedRowFilterTarget(
                        row,
                        typeLabel,
                        cachedDisplayName || row.displayName || ''
                    )
                )}
                className="grid h-[var(--vrcx-0-table-row-height)] items-center border-b border-[var(--vrcx-0-table-divider)] text-sm hover:bg-[var(--vrcx-0-table-row-hover-surface)] [&>*]:px-[var(--vrcx-0-table-cell-padding-inline)]"
                style={layout}
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                        'text-muted-foreground hover:text-foreground justify-self-center !px-0',
                        !canExpand && 'invisible'
                    )}
                    aria-label={
                        expanded
                            ? t('view.feed.actions.collapse_entry')
                            : t('view.feed.actions.expand_entry')
                    }
                    disabled={!canExpand}
                    onClick={onToggle}
                >
                    <ChevronRightIcon
                        data-icon="icon"
                        className={cn(
                            'transition-transform duration-150 ease-out',
                            expanded && 'rotate-90'
                        )}
                    />
                </Button>
                <div className="min-w-0 truncate">
                    <FeedListTime row={row} />
                </div>
                <div className="min-w-0 truncate">
                    <FeedUserLink
                        actions={actions}
                        cachedDisplayName={cachedDisplayName}
                        className="px-0 py-0"
                        filterCommands={filterCommands}
                        row={row}
                    />
                </div>
                <FeedTypeIndicator label={typeLabel} type={row.type} />
                <div className="min-w-0 truncate">
                    <FeedDetailCell
                        filterCommands={filterCommands}
                        loadingHistoryKey={loadingPreviousInstancesKey}
                        onNewInstance={actions.openFeedNewInstance}
                        onOpenPreviousInstances={onOpenPreviousInstances}
                        row={row}
                    />
                </div>
            </div>
            {expanded ? (
                <div
                    className="border-b border-[var(--vrcx-0-table-divider)] px-[var(--vrcx-0-table-cell-padding-inline)]"
                    style={{ minWidth: layout.minWidth }}
                >
                    <FeedExpandedRow
                        loadingHistoryKey={loadingPreviousInstancesKey}
                        onNewInstance={actions.openFeedNewInstance}
                        onOpenPreviousInstances={onOpenPreviousInstances}
                        row={row}
                    />
                </div>
            ) : null}
        </div>
    );
}

export function FeedVirtualListShell({
    actions,
    emptyFilterModel,
    filterCommands,
    favoritesOnly,
    friendLogNamesById,
    hasMore,
    hasUnloadedLatest,
    isFavoritesLoaded,
    loadStatus,
    loadingOlder,
    loadingPreviousInstancesKey,
    newCount = 0,
    onLoadOlder,
    onReloadLatest,
    onOpenPreviousInstances,
    onViewingLatestChange,
    resetKey,
    rows,
    sourceRows,
    table
}: FeedVirtualListShellProps) {
    const { t } = useTranslation();
    const tableDensity = usePreferencesStore((state) => state.tableDensity);
    const estimatedRowHeight = tableDensity === 'compact' ? 32 : 40;
    const entries = useMemo<FeedVirtualRow[]>(
        () => rows.map((row) => ({ key: getFeedRowId(row), row })),
        [rows]
    );
    const rowKeys = useMemo(
        () => new Set(entries.map((entry) => entry.key)),
        [entries]
    );
    const [expandedRowKeys, setExpandedRowKeys] = useState(
        () => new Set<string>()
    );
    const newRowKeys = useFeedNewTopRowKeys(sourceRows, resetKey);
    const listColumns = getFeedListColumns(table);
    const layout = getColumnGridLayout(listColumns, 'detail');
    useEffect(() => {
        setExpandedRowKeys(new Set());
    }, [resetKey]);

    useEffect(() => {
        setExpandedRowKeys((current) => {
            const retainedKeys = new Set(
                Array.from(current).filter((key) => rowKeys.has(key))
            );
            return retainedKeys.size === current.size ? current : retainedKeys;
        });
    }, [rowKeys]);

    return (
        <LogFilterContextMenu commands={filterCommands}>
            <div className="flex min-h-0 flex-1 flex-col">
                <VirtualHistoryList
                    rows={entries}
                    estimatedRowHeight={estimatedRowHeight}
                    resetKey={resetKey}
                    minWidth={layout.minWidth}
                    sizingStyle={getColumnSizeVars(listColumns)}
                    header={<FeedListHeader layout={layout} table={table} />}
                    hasMore={hasMore}
                    loadingOlder={loadingOlder}
                    onLoadOlder={onLoadOlder}
                    hasUnloadedLatest={hasUnloadedLatest}
                    onReloadLatest={onReloadLatest}
                    onViewingLatestChange={onViewingLatestChange}
                    latestLabel={t('view.feed.columns.latest')}
                    newCount={newCount}
                    rowClassName={(entry) =>
                        newRowKeys.has(entry.key)
                            ? 'feed-column-row-new'
                            : undefined
                    }
                    renderRow={(entry) => (
                        <FeedVirtualListRow
                            actions={actions}
                            cachedDisplayName={
                                friendLogNamesById[
                                    resolveFeedUserId(entry.row)
                                ] || ''
                            }
                            expanded={expandedRowKeys.has(entry.key)}
                            filterCommands={filterCommands}
                            layout={layout}
                            loadingPreviousInstancesKey={
                                loadingPreviousInstancesKey
                            }
                            onOpenPreviousInstances={onOpenPreviousInstances}
                            onToggle={() =>
                                setExpandedRowKeys((current) => {
                                    const next = new Set(current);
                                    if (next.has(entry.key))
                                        next.delete(entry.key);
                                    else next.add(entry.key);
                                    return next;
                                })
                            }
                            row={entry.row}
                        />
                    )}
                    footer={
                        loadingOlder ? (
                            <>
                                <Spinner
                                    data-icon="inline-start"
                                    className="mr-2"
                                />
                                {t('common.load_more')}...
                            </>
                        ) : hasMore ? (
                            <span>{t('common.load_more')}</span>
                        ) : (
                            <span>
                                {rows.length} {t('view.feed.label.rows')} ·{' '}
                                {t('common.no_more')}
                            </span>
                        )
                    }
                    emptyState={
                        loadStatus === 'running' ? (
                            <span className="inline-flex items-center gap-2">
                                <Spinner />
                                {t('view.feed.loading.loading_feed_rows')}
                            </span>
                        ) : favoritesOnly && !isFavoritesLoaded ? (
                            t('view.feed.label.favorites_are_still_hydrating')
                        ) : loadStatus === 'error' ? (
                            t('view.feed.error.feed_query_failed')
                        ) : (
                            <FeedEmptyState {...emptyFilterModel} />
                        )
                    }
                />
            </div>
        </LogFilterContextMenu>
    );
}
