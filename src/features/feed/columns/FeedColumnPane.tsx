import {
    ArrowUpToLineIcon,
    GripVerticalIcon,
    MoreHorizontalIcon,
    SettingsIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { FeedTimeDisplayModePreference } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';

import type { FeedColumnDensityConfig } from '../feedColumnsDensity';
import type { FeedColumnConfig } from '../feedColumnsState';
import { getFeedRowId } from '../feedRows';
import type {
    FeedFriendActions,
    FeedLocationActionPayload,
    FeedRow
} from '../feedTypes';
import { FeedColumnItem } from './FeedColumnItem';
import { useFeedColumnRows } from './useFeedColumnRows';

const OVERSCAN = 8;
const NEW_ROW_ANIMATION_MS = 1700;
const NEW_ROW_ANIMATION_LIMIT = 6;

type FeedColumnPaneProps = {
    actions: FeedFriendActions;
    column: FeedColumnConfig;
    densityConfig: FeedColumnDensityConfig;
    dragHandleProps?: {
        attributes?: any;
        listeners?: any;
    };
    loadingPreviousInstancesKey: string;
    nowMs: number;
    onDelete(columnId: string): void;
    onEdit(columnId: string): void;
    onOpenPreviousInstances(payload?: FeedLocationActionPayload): void;
    timeDisplayMode: FeedTimeDisplayModePreference;
};

function useColumnViewport(
    rows: FeedRow[],
    loadOlder: () => void,
    itemStep: number
) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const previousRowsRef = useRef<FeedRow[]>(rows);
    const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });
    const totalHeight = rows.length * itemStep;

    useLayoutEffect(() => {
        const element = viewportRef.current;
        const previousRows = previousRowsRef.current;
        previousRowsRef.current = rows;
        if (!element || element.scrollTop <= itemStep || !previousRows.length) {
            return;
        }
        const previousIndex = Math.floor(element.scrollTop / itemStep);
        const previousKey = previousRows[previousIndex]
            ? getFeedRowId(previousRows[previousIndex])
            : '';
        if (!previousKey) {
            return;
        }
        const nextIndex = rows.findIndex(
            (row) => getFeedRowId(row) === previousKey
        );
        if (nextIndex < 0 || nextIndex === previousIndex) {
            return;
        }
        const offset = element.scrollTop - previousIndex * itemStep;
        element.scrollTop = nextIndex * itemStep + offset;
    }, [itemStep, rows]);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) {
            return undefined;
        }
        let frameId = 0;
        const updateViewport = () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
            frameId = requestAnimationFrame(() => {
                frameId = 0;
                setViewport({
                    height: element.clientHeight,
                    scrollTop: element.scrollTop
                });
            });
        };

        updateViewport();
        element.addEventListener('scroll', updateViewport, { passive: true });
        const observer =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(updateViewport)
                : null;
        observer?.observe(element);
        return () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
            observer?.disconnect();
            element.removeEventListener('scroll', updateViewport);
        };
    }, []);

    useEffect(() => {
        if (!viewport.height || !rows.length) {
            return;
        }
        if (
            viewport.scrollTop + viewport.height >=
            totalHeight - itemStep * 8
        ) {
            loadOlder();
        }
    }, [
        itemStep,
        loadOlder,
        rows.length,
        totalHeight,
        viewport.height,
        viewport.scrollTop
    ]);

    const virtualItems = useMemo(() => {
        const firstIndex = Math.max(
            0,
            Math.floor(viewport.scrollTop / itemStep) - OVERSCAN
        );
        const lastIndex = Math.min(
            rows.length,
            Math.ceil((viewport.scrollTop + viewport.height) / itemStep) +
                OVERSCAN
        );
        return rows.slice(firstIndex, lastIndex).map((row, offset) => {
            const index = firstIndex + offset;
            return {
                index,
                key: getFeedRowId(row),
                row,
                top: index * itemStep
            };
        });
    }, [itemStep, rows, viewport.height, viewport.scrollTop]);

    const scrollToLatest = () => {
        if (viewportRef.current) {
            viewportRef.current.scrollTop = 0;
        }
    };

    return {
        scrollToLatest,
        showLatestButton: viewport.scrollTop > itemStep,
        totalHeight,
        viewportRef,
        virtualItems
    };
}

function useNewTopRowKeys(rows: FeedRow[], resetKey: string) {
    const previousRowKeysRef = useRef<string[]>([]);
    const previousResetKeyRef = useRef(resetKey);
    const clearTimerRef = useRef<number | null>(null);
    const [newRowKeys, setNewRowKeys] = useState<Set<string>>(() => new Set());

    useEffect(() => {
        const nextKeys = rows.map(getFeedRowId).filter(Boolean);
        if (previousResetKeyRef.current !== resetKey) {
            previousResetKeyRef.current = resetKey;
            previousRowKeysRef.current = nextKeys;
            setNewRowKeys(new Set());
            return;
        }

        const previousKeys = previousRowKeysRef.current;
        previousRowKeysRef.current = nextKeys;

        if (!previousKeys.length || !nextKeys.length) {
            return;
        }

        const previousFirstIndex = nextKeys.indexOf(previousKeys[0]);
        if (previousFirstIndex <= 0) {
            return;
        }

        const incomingKeys = nextKeys.slice(
            0,
            Math.min(previousFirstIndex, NEW_ROW_ANIMATION_LIMIT)
        );
        setNewRowKeys(new Set(incomingKeys));

        if (clearTimerRef.current) {
            window.clearTimeout(clearTimerRef.current);
        }
        clearTimerRef.current = window.setTimeout(() => {
            clearTimerRef.current = null;
            setNewRowKeys(new Set());
        }, NEW_ROW_ANIMATION_MS);
    }, [resetKey, rows]);

    useEffect(
        () => () => {
            if (clearTimerRef.current) {
                window.clearTimeout(clearTimerRef.current);
            }
        },
        []
    );

    return newRowKeys;
}

export function FeedColumnPane({
    actions,
    column,
    densityConfig,
    dragHandleProps,
    loadingPreviousInstancesKey,
    nowMs,
    onDelete,
    onEdit,
    onOpenPreviousInstances,
    timeDisplayMode
}: FeedColumnPaneProps) {
    const { t } = useTranslation();
    const { hasMore, loadOlder, loadingOlder, loadStatus, rows } =
        useFeedColumnRows(column);
    const columnRowsResetKey = useMemo(
        () =>
            JSON.stringify({
                feedTypes: column.feedTypes,
                friendScope: column.friendScope,
                id: column.id
            }),
        [column.feedTypes, column.friendScope, column.id]
    );
    const newRowKeys = useNewTopRowKeys(rows, columnRowsResetKey);
    const {
        scrollToLatest,
        showLatestButton,
        totalHeight,
        viewportRef,
        virtualItems
    } = useColumnViewport(rows, loadOlder, densityConfig.rowHeight);
    const scopeLabel =
        column.friendScope.kind === 'favorites'
            ? column.friendScope.groupKeys === 'all'
                ? t('view.feed.columns.all_favorites')
                : t('view.feed.columns.groups_count', {
                      count: column.friendScope.groupKeys.length
                  })
            : t('view.feed.columns.all_friends');
    const excludedGroupKeys = column.friendScope.excludedFavoriteGroupKeys;
    const exclusionLabel =
        excludedGroupKeys === 'all'
            ? t('view.feed.columns.except_all_favorites')
            : Array.isArray(excludedGroupKeys) && excludedGroupKeys.length
              ? t('view.feed.columns.except_groups_count', {
                    count: excludedGroupKeys.length
                })
              : '';
    const typeLabels = column.feedTypes.map((type) =>
        t(`view.feed.filters.${type}`)
    );
    const visibleTypeLabels = typeLabels.slice(0, 3);
    const hiddenTypeCount = Math.max(
        0,
        typeLabels.length - visibleTypeLabels.length
    );

    return (
        <section
            className="border-border/60 bg-background/35 group/feed-column relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-md border"
            style={{ width: column.width }}
        >
            <div className="border-border/70 bg-muted/20 group/feed-column-header flex shrink-0 flex-col gap-1.5 border-b px-3 py-2">
                <div className="flex min-w-0 items-start gap-1">
                    <div className="min-w-0 flex-1 text-left">
                        <div className="text-foreground truncate text-sm leading-5 font-semibold">
                            {column.title}
                        </div>
                        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                            <span
                                className="border-border/60 bg-background/60 text-muted-foreground shrink-0 truncate rounded-sm border px-1.5 py-0 text-[10px] leading-4 font-medium"
                                title={scopeLabel}
                            >
                                {scopeLabel}
                            </span>
                            {exclusionLabel ? (
                                <span
                                    className="border-border/45 bg-muted/30 text-muted-foreground max-w-28 shrink-0 truncate rounded-sm border px-1.5 py-0 text-[10px] leading-4"
                                    title={exclusionLabel}
                                >
                                    {exclusionLabel}
                                </span>
                            ) : null}
                            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                                {visibleTypeLabels.map((label, index) => (
                                    <span
                                        key={`${column.feedTypes[index]}:${label}`}
                                        className="border-border/45 bg-muted/25 text-muted-foreground max-w-20 shrink-0 truncate rounded-sm border px-1.5 py-0 text-[10px] leading-4"
                                        title={label}
                                    >
                                        {label}
                                    </span>
                                ))}
                                {hiddenTypeCount ? (
                                    <span className="border-border/45 bg-muted/25 text-muted-foreground shrink-0 rounded-sm border px-1.5 py-0 text-[10px] leading-4">
                                        +{hiddenTypeCount}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab opacity-0 transition-opacity group-hover/feed-column-header:opacity-100 focus-visible:opacity-100"
                        aria-label={t(
                            'nav_menu.custom_nav.dynamic.drag_value',
                            {
                                value: column.title
                            }
                        )}
                        {...dragHandleProps?.attributes}
                        {...dragHandleProps?.listeners}
                    >
                        <GripVerticalIcon data-icon="icon" />
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={t('accessibility.more')}
                            >
                                <MoreHorizontalIcon data-icon="icon" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    onClick={() => onEdit(column.id)}
                                >
                                    <SettingsIcon data-icon="inline-start" />
                                    {t('common.actions.configure')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => onDelete(column.id)}
                                >
                                    <Trash2Icon data-icon="inline-start" />
                                    {t('common.actions.delete')}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            <div className="relative min-h-0 flex-1">
                {showLatestButton ? (
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="bg-popover/95 absolute top-2 left-1/2 z-20 h-7 -translate-x-1/2 rounded-full border px-3 text-xs shadow-md backdrop-blur"
                        onClick={scrollToLatest}
                    >
                        <ArrowUpToLineIcon data-icon="inline-start" />
                        {t('view.feed.columns.latest')}
                    </Button>
                ) : null}
                <div
                    ref={viewportRef}
                    className={cn(
                        'h-full min-h-0 overflow-y-auto',
                        loadStatus === 'error' && 'text-destructive'
                    )}
                >
                    {loadStatus === 'running' ? (
                        <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
                            <Spinner />
                            {t('view.feed.loading.loading_feed_rows')}
                        </div>
                    ) : rows.length ? (
                        <div
                            className="relative"
                            style={{ height: totalHeight }}
                        >
                            {virtualItems.map((item) => (
                                <div
                                    key={item.key}
                                    className="absolute right-0 left-0"
                                    style={{
                                        height: densityConfig.rowHeight,
                                        top: item.top
                                    }}
                                >
                                    <FeedColumnItem
                                        actions={actions}
                                        animateEntry={newRowKeys.has(item.key)}
                                        loadingPreviousInstancesKey={
                                            loadingPreviousInstancesKey
                                        }
                                        densityConfig={densityConfig}
                                        nowMs={nowMs}
                                        onOpenPreviousInstances={
                                            onOpenPreviousInstances
                                        }
                                        row={item.row}
                                        showTypeHint={
                                            column.feedTypes.length > 1
                                        }
                                        timeDisplayMode={timeDisplayMode}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-muted-foreground flex h-full items-center justify-center px-4 text-center text-sm">
                            {loadStatus === 'error'
                                ? t('view.feed.error.feed_query_failed')
                                : t(
                                      'view.feed.empty.no_feed_rows_match_the_current_filters'
                                  )}
                        </div>
                    )}
                    {loadingOlder ? (
                        <div className="text-muted-foreground flex justify-center py-2">
                            <Spinner />
                        </div>
                    ) : null}
                    {!hasMore && rows.length ? <div className="h-2" /> : null}
                </div>
            </div>
        </section>
    );
}
