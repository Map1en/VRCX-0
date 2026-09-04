import { flexRender, type SortingState } from '@tanstack/react-table';
import { ArrowUpToLineIcon, ChevronRightIcon } from 'lucide-react';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type PointerEvent
} from 'react';
import { useTranslation } from 'react-i18next';

import type { AppHeader } from '@/components/data-table/appTable';
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
import { useVirtualSidebarRows } from '@/components/sidebar/useVirtualSidebarRows';
import { cn } from '@/lib/utils';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { useFeedNewTopRowKeys } from '../useFeedNewTopRowKeys';
import {
    FeedExpandedRow,
    FeedUserLink,
    formatTimestampLong,
    formatTimestampParts
} from './FeedTableParts';

type FeedVirtualListShellProps = {
    actions: FeedFriendActions;
    favoritesOnly: boolean;
    friendLogNamesById: Record<string, string>;
    hasMore: boolean;
    hasUnloadedLatest: boolean;
    isFavoritesLoaded: boolean;
    loadStatus: FeedLoadStatus;
    loadingOlder: boolean;
    loadingPreviousInstancesKey: string;
    onLoadOlder(): void;
    onReloadLatest(): void;
    onOpenPreviousInstances(payload?: FeedLocationActionPayload): void;
    onViewingLatestChange(value: boolean): void;
    resetKey: string;
    rows: FeedRow[];
    sorting: SortingState;
    sourceRows: FeedRow[];
    table: FeedTableInstance;
};

type FeedVirtualRow = {
    key: string;
    row: FeedRow;
};

type FeedListLayout = {
    gridTemplateColumns: string;
    minWidth: number;
};

type FeedListResizeSession = {
    pointerId: number;
    startWidth: number;
    startX: number;
};

function getFeedListLayout(table: FeedTableInstance): FeedListLayout {
    const timeWidth = table.getColumn('created_at')?.getSize() ?? 144;
    const userWidth = table.getColumn('displayName')?.getSize() ?? 160;
    const typeWidth = table.getColumn('type')?.getSize() ?? 96;
    const detailWidth = table.getColumn('detail')?.getSize() ?? 240;
    return {
        gridTemplateColumns: `2rem ${timeWidth}px ${userWidth}px ${typeWidth}px minmax(${detailWidth}px, 1fr)`,
        minWidth: 32 + timeWidth + userWidth + typeWidth + detailWidth
    };
}

function clampFeedListColumnSize(header: AppHeader<FeedRow>, size: number) {
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;
    return Math.min(maxSize, Math.max(minSize, Math.round(size)));
}

function resizeFeedListColumnFromKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    header: AppHeader<FeedRow>
) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
    }
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const step = event.shiftKey ? 32 : 16;
    const size = clampFeedListColumnSize(
        header,
        header.column.getSize() + direction * step
    );
    header.getContext().table.setColumnSizing((current) => ({
        ...current,
        [header.column.id]: size
    }));
}

function FeedListResizeHandle({
    header,
    label
}: {
    header: AppHeader<FeedRow>;
    label: string;
}) {
    const { t } = useTranslation();
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;
    const resizeSessionRef = useRef<FeedListResizeSession | null>(null);

    const updateResize = (event: PointerEvent<HTMLButtonElement>) => {
        const session = resizeSessionRef.current;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }
        const size = clampFeedListColumnSize(
            header,
            session.startWidth + event.clientX - session.startX
        );
        header.getContext().table.setColumnSizing((current) => ({
            ...current,
            [header.column.id]: size
        }));
    };

    const endResize = (event: PointerEvent<HTMLButtonElement>) => {
        if (resizeSessionRef.current?.pointerId !== event.pointerId) {
            return;
        }
        updateResize(event);
        resizeSessionRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    return (
        <Button
            type="button"
            variant="ghost"
            role="separator"
            aria-label={t('accessibility.resize_column', { column: label })}
            aria-orientation="vertical"
            aria-valuemin={minSize}
            aria-valuemax={maxSize}
            aria-valuenow={header.column.getSize()}
            className={cn(
                'hover:bg-border absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none rounded-none border-0 bg-transparent p-0',
                header.column.getIsResizing() && 'bg-primary'
            )}
            onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                resizeSessionRef.current = {
                    pointerId: event.pointerId,
                    startWidth:
                        event.currentTarget.parentElement?.getBoundingClientRect()
                            .width || header.column.getSize(),
                    startX: event.clientX
                };
            }}
            onPointerMove={updateResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={(event) =>
                resizeFeedListColumnFromKeyboard(event, header)
            }
        />
    );
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
            className="grid min-h-[var(--vrcx-0-table-header-height)] items-center gap-2 px-[var(--vrcx-0-table-cell-padding-inline)] text-xs text-[var(--vrcx-0-table-header-foreground)]"
            style={layout}
        >
            <span aria-hidden="true" />
            {definitions.map(({ id, label }) => {
                const header = headers.find((entry) => entry.column.id === id);
                return (
                    <div
                        key={id}
                        className="relative flex h-full min-w-0 items-center pr-2"
                    >
                        <span className="min-w-0 truncate">
                            {header
                                ? flexRender(
                                      header.column.columnDef.header,
                                      header.getContext()
                                  )
                                : label}
                        </span>
                        {header ? (
                            <FeedListResizeHandle
                                header={header}
                                label={label}
                            />
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

function FeedListTime({ row }: { row: FeedRow }) {
    const { date, time } = formatTimestampParts(row.created_at);
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span className="text-muted-foreground text-sm tabular-nums">
                        <span>{date}</span>
                        {time ? <span className="ml-1">{time}</span> : null}
                    </span>
                }
            />
            <TooltipContent side="right">
                {formatTimestampLong(row.created_at)}
            </TooltipContent>
        </Tooltip>
    );
}

function FeedVirtualListRow({
    actions,
    cachedDisplayName,
    expanded,
    layout,
    loadingPreviousInstancesKey,
    onOpenPreviousInstances,
    onToggle,
    row
}: {
    actions: FeedFriendActions;
    cachedDisplayName: string;
    expanded: boolean;
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
                className="grid h-[var(--vrcx-0-table-row-height)] items-center gap-2 border-b border-[var(--vrcx-0-table-divider)] px-[var(--vrcx-0-table-cell-padding-inline)] py-[var(--vrcx-0-table-cell-padding-block)] hover:bg-[var(--vrcx-0-table-row-hover-surface)]"
                style={layout}
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                        'text-muted-foreground hover:text-foreground -ml-2',
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
                        row={row}
                    />
                </div>
                <FeedTypeIndicator label={typeLabel} type={row.type} />
                <div className="min-w-0 truncate">
                    <FeedDetailCell
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
    favoritesOnly,
    friendLogNamesById,
    hasMore,
    hasUnloadedLatest,
    isFavoritesLoaded,
    loadStatus,
    loadingOlder,
    loadingPreviousInstancesKey,
    onLoadOlder,
    onReloadLatest,
    onOpenPreviousInstances,
    onViewingLatestChange,
    resetKey,
    rows,
    sorting,
    sourceRows,
    table
}: FeedVirtualListShellProps) {
    const { t } = useTranslation();
    const tableDensity = usePreferencesStore((state) => state.tableDensity);
    const estimatedRowHeight = tableDensity === 'compact' ? 32 : 40;
    const estimateRowHeight = useCallback(
        () => estimatedRowHeight,
        [estimatedRowHeight]
    );
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
    const layout = getFeedListLayout(table);
    const scrollResetKey = `${resetKey}:${JSON.stringify(sorting)}`;
    const latestAtTop =
        sorting.length === 0 ||
        (sorting.length === 1 &&
            sorting[0].id === 'created_at' &&
            sorting[0].desc === true);
    const {
        getRowRef,
        scrollToStart,
        scrollTop,
        totalSize,
        viewportRef,
        virtualItems
    } = useVirtualSidebarRows(entries, estimateRowHeight, {
        preserveScrollAnchor: true,
        resetKey: scrollResetKey
    });
    const [viewportElement, setViewportElement] =
        useState<HTMLDivElement | null>(null);
    const headerViewportRef = useRef<HTMLDivElement | null>(null);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const setViewportRef = useCallback(
        (element: HTMLDivElement | null) => {
            setViewportElement(element);
            viewportRef(element);
        },
        [viewportRef]
    );

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

    useEffect(() => {
        if (!viewportElement) {
            return undefined;
        }
        const syncHeaderScroll = () => {
            if (headerViewportRef.current) {
                headerViewportRef.current.scrollLeft =
                    viewportElement.scrollLeft;
            }
            onViewingLatestChange(
                viewportElement.scrollTop <= estimatedRowHeight
            );
        };
        syncHeaderScroll();
        viewportElement.addEventListener('scroll', syncHeaderScroll, {
            passive: true
        });
        return () =>
            viewportElement.removeEventListener('scroll', syncHeaderScroll);
    }, [estimatedRowHeight, onViewingLatestChange, viewportElement]);

    useEffect(() => {
        if (
            !hasMore ||
            loadingOlder ||
            typeof IntersectionObserver !== 'function'
        ) {
            return undefined;
        }
        const root = viewportElement;
        const sentinel = sentinelRef.current;
        if (!root || !sentinel) {
            return undefined;
        }
        const observer = new IntersectionObserver(
            (observedEntries) => {
                if (observedEntries.some((entry) => entry.isIntersecting)) {
                    onLoadOlder();
                }
            },
            { root, rootMargin: '320px' }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, loadingOlder, onLoadOlder, rows.length, viewportElement]);

    return (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--vrcx-0-table-border)] bg-[var(--vrcx-0-table-surface)]">
            <div
                ref={headerViewportRef}
                className="shrink-0 overflow-hidden bg-[var(--vrcx-0-table-header-surface)]"
            >
                <FeedListHeader layout={layout} table={table} />
            </div>
            {hasUnloadedLatest || scrollTop > estimatedRowHeight ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="bg-popover/95 absolute top-[calc(var(--vrcx-0-table-header-height)+0.5rem)] left-1/2 z-20 h-7 -translate-x-1/2 rounded-full border px-3 text-xs shadow-md backdrop-blur"
                    onClick={hasUnloadedLatest ? onReloadLatest : scrollToStart}
                >
                    <ArrowUpToLineIcon data-icon="inline-start" />
                    {t(
                        hasUnloadedLatest || latestAtTop
                            ? 'view.feed.columns.latest'
                            : 'view.feed.actions.back_to_top'
                    )}
                </Button>
            ) : null}
            <div
                ref={setViewportRef}
                className="min-h-0 flex-1 overflow-auto [overflow-anchor:none]"
            >
                {rows.length ? (
                    <>
                        <div
                            className="relative"
                            style={{
                                height: totalSize,
                                minWidth: layout.minWidth
                            }}
                        >
                            {virtualItems.map(({ key, row: entry, start }) => (
                                <div
                                    key={String(key)}
                                    ref={getRowRef(key)}
                                    className={cn(
                                        'absolute right-0 left-0',
                                        newRowKeys.has(String(key)) &&
                                            'feed-column-row-new'
                                    )}
                                    style={{
                                        transform: `translateY(${start}px)`
                                    }}
                                >
                                    <FeedVirtualListRow
                                        actions={actions}
                                        cachedDisplayName={
                                            friendLogNamesById[
                                                resolveFeedUserId(entry.row)
                                            ] || ''
                                        }
                                        expanded={expandedRowKeys.has(
                                            String(key)
                                        )}
                                        layout={layout}
                                        loadingPreviousInstancesKey={
                                            loadingPreviousInstancesKey
                                        }
                                        onOpenPreviousInstances={
                                            onOpenPreviousInstances
                                        }
                                        onToggle={() => {
                                            setExpandedRowKeys((current) => {
                                                const next = new Set(current);
                                                if (next.has(String(key))) {
                                                    next.delete(String(key));
                                                } else {
                                                    next.add(String(key));
                                                }
                                                return next;
                                            });
                                        }}
                                        row={entry.row}
                                    />
                                </div>
                            ))}
                        </div>
                        <div
                            ref={sentinelRef}
                            className="text-muted-foreground flex min-h-10 items-center justify-center px-3 py-2 text-sm"
                        >
                            {loadingOlder ? (
                                <>
                                    <Spinner
                                        data-icon="inline-start"
                                        className="mr-2"
                                    />
                                    {t('common.load_more')}...
                                </>
                            ) : hasMore ? (
                                <span>{t('common.load_more')}...</span>
                            ) : (
                                <span>
                                    {rows.length} {t('view.feed.label.rows')} ·{' '}
                                    {t('common.no_more')}
                                </span>
                            )}
                        </div>
                    </>
                ) : (
                    <div
                        className="text-muted-foreground flex h-full min-h-24 items-center justify-center px-4 text-center text-sm"
                        style={{ minWidth: layout.minWidth }}
                    >
                        {loadStatus === 'running' ? (
                            <span className="inline-flex items-center gap-2">
                                <Spinner />
                                {t('view.feed.loading.loading_feed_rows')}
                            </span>
                        ) : favoritesOnly && !isFavoritesLoaded ? (
                            t('view.feed.label.favorites_are_still_hydrating')
                        ) : loadStatus === 'error' ? (
                            t('view.feed.error.feed_query_failed')
                        ) : (
                            t(
                                'view.feed.empty.no_feed_rows_match_the_current_filters'
                            )
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
