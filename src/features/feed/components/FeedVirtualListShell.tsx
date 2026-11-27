import { ChevronRightIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    type ColumnGridLayout,
    getColumnGridLayout,
    getColumnSizeVars
} from '@/components/data-table/columnSizing';
import {
    LogFilterContextMenu,
    getLogFilterRowAttributes,
    type LogFilterCommands
} from '@/components/data-table/LogFilterContextMenu';
import { getStretchColumnId } from '@/components/data-table/tableColumnLayout';
import { TimestampText } from '@/components/data-table/TimestampText';
import { VirtualHistoryList } from '@/components/data-table/VirtualHistoryList';
import { VirtualListColumnHeader } from '@/components/data-table/VirtualListColumnHeader';
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
import { formatDateFilter } from '@/lib/dateTime';
import { useTodayDate } from '@/lib/useTodayDate';
import { cn } from '@/lib/utils';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { buildFeedListEntries, feedLocalDayKey } from '../feedListEntries';
import { getFeedRowFilterTarget } from '../feedRowFilterTarget';
import { shouldSkipFeedRowToggle } from '../feedRowInteraction';
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

type FeedListLayout = ColumnGridLayout;

function FeedListTime({ row }: { row: FeedRow }) {
    return (
        <TimestampText
            value={row.created_at}
            format="time"
            tooltipSide="right"
            className="text-muted-foreground text-sm tabular-nums"
        />
    );
}

function FeedListDayHeading({
    label,
    layout
}: {
    label: string;
    layout: FeedListLayout;
}) {
    return (
        <div
            className="grid h-8 items-end border-b border-[var(--vrcx-0-table-divider)] pb-1.5"
            style={layout}
        >
            <span className="text-muted-foreground col-[2/-1] px-[var(--vrcx-0-table-cell-padding-inline)] text-xs font-medium tracking-wide tabular-nums">
                {label}
            </span>
        </div>
    );
}

const FeedVirtualListRow = memo(function FeedVirtualListRow({
    actions,
    cachedDisplayName,
    columnIds,
    expanded,
    layout,
    filterCommands,
    loadingPreviousInstancesKey,
    onOpenPreviousInstances,
    onToggle,
    row,
    rowKey
}: {
    actions: FeedFriendActions;
    cachedDisplayName: string;
    columnIds: readonly string[];
    expanded: boolean;
    filterCommands: LogFilterCommands;
    layout: FeedListLayout;
    loadingPreviousInstancesKey: string;
    onOpenPreviousInstances(payload?: FeedLocationActionPayload): void;
    onToggle(rowKey: string): void;
    row: FeedRow;
    rowKey: string;
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
                role="presentation"
                data-feed-list-summary=""
                data-vrcx-0-list-row=""
                data-state={expanded ? 'expanded' : undefined}
                {...getLogFilterRowAttributes(
                    getFeedRowFilterTarget(
                        row,
                        typeLabel,
                        cachedDisplayName || row.displayName || ''
                    )
                )}
                className={cn(
                    'grid h-[var(--vrcx-0-table-row-height)] items-center border-b border-[var(--vrcx-0-table-divider)] text-sm hover:bg-[var(--vrcx-0-table-row-hover-surface)] [&>*]:px-[var(--vrcx-0-table-cell-padding-inline)]',
                    canExpand && 'group/feed-row cursor-pointer'
                )}
                style={layout}
                onClick={
                    canExpand
                        ? (event) => {
                              if (!shouldSkipFeedRowToggle(event)) {
                                  onToggle(rowKey);
                              }
                          }
                        : undefined
                }
            >
                {columnIds.map((columnId) =>
                    columnId === 'expander' ? (
                        <Button
                            key={columnId}
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className={cn(
                                'text-muted-foreground hover:text-foreground justify-self-center !px-0 group-hover/feed-row:opacity-100 focus-visible:opacity-100',
                                !canExpand && 'invisible',
                                !expanded && 'opacity-0'
                            )}
                            aria-label={
                                expanded
                                    ? t('view.feed.actions.collapse_entry')
                                    : t('view.feed.actions.expand_entry')
                            }
                            disabled={!canExpand}
                            onClick={() => onToggle(rowKey)}
                        >
                            <ChevronRightIcon
                                data-icon="icon"
                                className={cn(
                                    'transition-transform duration-150 ease-out',
                                    expanded && 'rotate-90'
                                )}
                            />
                        </Button>
                    ) : columnId === 'type' ? (
                        <FeedTypeIndicator
                            key={columnId}
                            label={typeLabel}
                            type={row.type}
                        />
                    ) : (
                        <div key={columnId} className="min-w-0 truncate">
                            {columnId === 'created_at' ? (
                                <FeedListTime row={row} />
                            ) : columnId === 'displayName' ? (
                                <FeedUserLink
                                    actions={actions}
                                    cachedDisplayName={cachedDisplayName}
                                    className="px-0 py-0"
                                    filterCommands={filterCommands}
                                    row={row}
                                />
                            ) : columnId === 'detail' ? (
                                <FeedDetailCell
                                    filterCommands={filterCommands}
                                    loadingHistoryKey={
                                        loadingPreviousInstancesKey
                                    }
                                    onNewInstance={actions.openFeedNewInstance}
                                    onOpenPreviousInstances={
                                        onOpenPreviousInstances
                                    }
                                    row={row}
                                />
                            ) : null}
                        </div>
                    )
                )}
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
});

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
    const todayDate = useTodayDate();
    const todayKey = feedLocalDayKey(todayDate);
    const entries = useMemo(
        () => buildFeedListEntries(rows, todayKey),
        [rows, todayKey]
    );
    const rowKeys = useMemo(
        () => new Set(rows.map((row) => getFeedRowId(row))),
        [rows]
    );
    const [expandedRowKeys, setExpandedRowKeys] = useState(
        () => new Set<string>()
    );
    const newRowKeys = useFeedNewTopRowKeys(sourceRows, resetKey);
    const listColumns = table.getVisibleLeafColumns();
    const columnIds = useMemo(
        () => listColumns.map((column) => column.id),
        [listColumns]
    );
    const { gridTemplateColumns, minWidth } = getColumnGridLayout(
        listColumns,
        getStretchColumnId(table)
    );
    const layout = useMemo(
        () => ({ gridTemplateColumns, minWidth }),
        [gridTemplateColumns, minWidth]
    );
    const toggleRow = useCallback((rowKey: string) => {
        setExpandedRowKeys((current) => {
            const next = new Set(current);
            if (next.has(rowKey)) next.delete(rowKey);
            else next.add(rowKey);
            return next;
        });
    }, []);
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
                    header={
                        <VirtualListColumnHeader
                            layout={layout}
                            table={table}
                        />
                    }
                    hasMore={hasMore}
                    loadingOlder={loadingOlder}
                    onLoadOlder={onLoadOlder}
                    hasUnloadedLatest={hasUnloadedLatest}
                    onReloadLatest={onReloadLatest}
                    onViewingLatestChange={onViewingLatestChange}
                    latestLabel={t('view.feed.columns.latest')}
                    newCount={newCount}
                    rowClassName={(entry) =>
                        entry.kind === 'row' && newRowKeys.has(entry.key)
                            ? 'feed-column-row-new'
                            : undefined
                    }
                    renderRow={(entry) =>
                        entry.kind === 'day' ? (
                            <FeedListDayHeading
                                label={formatDateFilter(
                                    entry.createdAt,
                                    'weekdayDate'
                                )}
                                layout={layout}
                            />
                        ) : (
                            <FeedVirtualListRow
                                actions={actions}
                                cachedDisplayName={
                                    friendLogNamesById[
                                        resolveFeedUserId(entry.row)
                                    ] || ''
                                }
                                columnIds={columnIds}
                                expanded={expandedRowKeys.has(entry.key)}
                                filterCommands={filterCommands}
                                layout={layout}
                                loadingPreviousInstancesKey={
                                    loadingPreviousInstancesKey
                                }
                                onOpenPreviousInstances={
                                    onOpenPreviousInstances
                                }
                                onToggle={toggleRow}
                                row={entry.row}
                                rowKey={entry.key}
                            />
                        )
                    }
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
