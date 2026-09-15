import { FootprintsIcon, Trash2Icon } from 'lucide-react';
import {
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';

import {
    DateTimeRangePicker,
    type DateTimeRangeValue
} from '@/components/date-time-range-picker/DateTimeRangePicker';
import {
    EmptyState,
    LoadingState,
    PageScaffold,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import {
    toolbarSearchDateRangeTrigger,
    ToolbarActions,
    ToolbarOverflowMenu,
    ToolbarRefreshButton,
    ToolbarSearch,
    ToolbarTabs,
    ToolbarViews,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import { formatCompactDateTime, formatDateFilter } from '@/lib/dateTime';
import { getVisibleKnownSizeRows } from '@/lib/knownSizeVirtualRows';
import { useScrollViewportMetrics } from '@/lib/useScrollViewportMetrics';
import { useTodayDate } from '@/lib/useTodayDate';
import { cn } from '@/lib/utils';
import {
    browseHistoryRepository,
    type BrowseHistoryCursor,
    type BrowseHistoryEntityKind,
    type BrowseHistoryItemOutput
} from '@/repositories/browseHistoryRepository';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { DropdownMenuGroup, DropdownMenuItem } from '@/ui/shadcn/dropdown-menu';
import { Separator } from '@/ui/shadcn/separator';
import { Tabs, TabsContent } from '@/ui/shadcn/tabs';
import { Tooltip } from '@/ui/shadcn/tooltip';

import { BrowseHistoryCard } from './BrowseHistoryCard';
import {
    BROWSE_HISTORY_GRID_GAP,
    browseHistoryDayKey,
    buildBrowseHistoryRows
} from './browseHistoryRows';

const PAGE_LIMIT = 120;
const CARD_MIN_WIDTH = 232;
type HistoryFilter = 'all' | BrowseHistoryEntityKind;

export function BrowseHistoryPage() {
    const { t } = useTranslation();
    const todayDate = useTodayDate();
    const ownerUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const confirm = useModalStore((state) => state.confirm);
    const [filter, setFilter] = useState<HistoryFilter>('all');
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search.trim());
    const [dateRange, setDateRange] = useState<DateTimeRangeValue>({
        from: null,
        to: null
    });
    const [items, setItems] = useState<BrowseHistoryItemOutput[]>([]);
    const [cursor, setCursor] = useState<BrowseHistoryCursor | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [reloadNonce, setReloadNonce] = useState(0);
    const loadMoreLockedRef = useRef(false);
    const requestVersionRef = useRef(0);
    const loadedOwnerRef = useRef('');
    const { resetScrollTop, viewportMetrics, viewportRef } =
        useScrollViewportMetrics();

    const entityKind = filter === 'all' ? null : filter;
    const dateFrom = dateRange.from?.toISOString() || '';
    const dateTo = dateRange.to?.toISOString() || '';

    useEffect(() => {
        if (!ownerUserId) {
            setItems([]);
            setCursor(null);
            setLoading(false);
            return;
        }
        const requestVersion = ++requestVersionRef.current;
        if (loadedOwnerRef.current === ownerUserId) {
            setRefreshing(true);
        } else {
            setItems([]);
            setLoading(true);
        }
        setLoadError(false);
        setCursor(null);

        void browseHistoryRepository
            .query({
                ownerUserId,
                entityKind,
                search: deferredSearch,
                dateFrom,
                dateTo,
                cursor: null,
                limit: PAGE_LIMIT
            })
            .then((page) => {
                if (requestVersion === requestVersionRef.current) {
                    setItems(page.items);
                    setCursor(page.nextCursor);
                    resetScrollTop();
                }
            })
            .catch(() => {
                if (requestVersion === requestVersionRef.current) {
                    setItems([]);
                    setLoadError(true);
                }
            })
            .finally(() => {
                if (requestVersion === requestVersionRef.current) {
                    loadedOwnerRef.current = ownerUserId;
                    setLoading(false);
                    setRefreshing(false);
                }
            });
    }, [
        dateFrom,
        dateTo,
        deferredSearch,
        entityKind,
        ownerUserId,
        reloadNonce,
        resetScrollTop
    ]);

    const safeWidth = Math.max(0, viewportMetrics.width - 8);
    const columnCount = Math.max(
        1,
        Math.floor(
            (safeWidth + BROWSE_HISTORY_GRID_GAP) /
                (CARD_MIN_WIDTH + BROWSE_HISTORY_GRID_GAP)
        ) || 1
    );
    const positioned = useMemo(
        () => buildBrowseHistoryRows(items, columnCount),
        [columnCount, items]
    );
    const visibleRows = useMemo(
        () =>
            getVisibleKnownSizeRows<(typeof positioned.rows)[number]>({
                rows: positioned.rows,
                scrollTop: viewportMetrics.scrollTop,
                viewportHeight: viewportMetrics.viewportHeight,
                overscan: Math.max(520, viewportMetrics.viewportHeight)
            }),
        [
            positioned.rows,
            viewportMetrics.scrollTop,
            viewportMetrics.viewportHeight
        ]
    );

    const loadMore = useCallback(() => {
        if (
            !ownerUserId ||
            !cursor ||
            loadingMore ||
            loadMoreLockedRef.current
        ) {
            return;
        }
        loadMoreLockedRef.current = true;
        setLoadingMore(true);
        const requestVersion = requestVersionRef.current;
        void browseHistoryRepository
            .query({
                ownerUserId,
                entityKind,
                search: deferredSearch,
                dateFrom,
                dateTo,
                cursor,
                limit: PAGE_LIMIT
            })
            .then((page) => {
                if (requestVersion === requestVersionRef.current) {
                    setItems((current) => [...current, ...page.items]);
                    setCursor(page.nextCursor);
                }
            })
            .catch(() => {
                if (requestVersion === requestVersionRef.current) {
                    setCursor(null);
                    toast.add({
                        type: 'error',
                        title: t('browse_history.load_error')
                    });
                }
            })
            .finally(() => {
                loadMoreLockedRef.current = false;
                setLoadingMore(false);
            });
    }, [
        cursor,
        dateFrom,
        dateTo,
        deferredSearch,
        entityKind,
        loadingMore,
        ownerUserId,
        t
    ]);

    useEffect(() => {
        const remaining =
            positioned.totalHeight -
            viewportMetrics.scrollTop -
            viewportMetrics.viewportHeight;
        if (!loading && remaining < 700) {
            loadMore();
        }
    }, [
        loadMore,
        loading,
        positioned.totalHeight,
        viewportMetrics.scrollTop,
        viewportMetrics.viewportHeight
    ]);

    const filterOptions = useMemo<ToolbarSegmentOption<HistoryFilter>[]>(
        () => [
            { value: 'all', label: t('browse_history.filter.all') },
            { value: 'user', label: t('browse_history.filter.user') },
            { value: 'world', label: t('browse_history.filter.world') },
            { value: 'avatar', label: t('browse_history.filter.avatar') },
            { value: 'group', label: t('browse_history.filter.group') }
        ],
        [t]
    );

    const removeItem = useCallback(
        (item: BrowseHistoryItemOutput) => {
            if (!ownerUserId) {
                return Promise.resolve(false);
            }
            return browseHistoryRepository
                .delete(ownerUserId, item.entityKind, item.entityId)
                .then(() => {
                    setItems((current) =>
                        current.filter(
                            (candidate) =>
                                candidate.entityKind !== item.entityKind ||
                                candidate.entityId !== item.entityId
                        )
                    );
                    return true;
                })
                .catch(() => {
                    toast.add({
                        type: 'error',
                        title: t('browse_history.remove_failed')
                    });
                    return false;
                });
        },
        [ownerUserId, t]
    );

    const clearHistory = useCallback(async () => {
        if (!ownerUserId || !items.length) {
            return;
        }
        const result = await confirm({
            title: t('browse_history.confirmation.title'),
            description: t('browse_history.confirmation.description'),
            confirmText: t('common.actions.clear'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        try {
            await browseHistoryRepository.clear(ownerUserId, entityKind);
            setItems([]);
            setCursor(null);
        } catch {
            toast.add({
                type: 'error',
                title: t('browse_history.clear_failed')
            });
        }
    }, [confirm, entityKind, items.length, ownerUserId, t]);

    const todayKey = browseHistoryDayKey(todayDate.toISOString());
    const yesterdayKey = useMemo(() => {
        const yesterday = new Date(todayDate);
        yesterday.setDate(yesterday.getDate() - 1);
        return browseHistoryDayKey(yesterday.toISOString());
    }, [todayDate]);
    const dayLabel = useCallback(
        (dayKey: string) => {
            if (dayKey === todayKey) {
                return t('browse_history.date.today');
            }
            if (dayKey === yesterdayKey) {
                return t('browse_history.date.yesterday');
            }
            return formatDateFilter(`${dayKey}T12:00:00`, 'date');
        },
        [t, todayKey, yesterdayKey]
    );

    const isFiltered = Boolean(deferredSearch || dateFrom || dateTo);

    return (
        <PageScaffold>
            <Tabs
                value={filter}
                onValueChange={(value) => {
                    const option = filterOptions.find(
                        (entry) => entry.value === value
                    );
                    if (option) setFilter(option.value);
                }}
                className="flex min-h-0 flex-1 flex-col gap-0"
            >
                <PageToolbar>
                    <PageToolbarRow>
                        <ToolbarViews className="flex-wrap">
                            <ToolbarTabs options={filterOptions} />
                        </ToolbarViews>
                        <ToolbarSearch
                            value={search}
                            onValueChange={setSearch}
                            placeholder={t('browse_history.search_placeholder')}
                            trailing={
                                <Tooltip>
                                    <DateTimeRangePicker
                                        value={dateRange}
                                        onChange={setDateRange}
                                        align="end"
                                        renderTrigger={
                                            toolbarSearchDateRangeTrigger
                                        }
                                        placeholder={t(
                                            'browse_history.date_range'
                                        )}
                                        startLabel={t(
                                            'browse_history.date_range_start'
                                        )}
                                        endLabel={t(
                                            'browse_history.date_range_end'
                                        )}
                                        clearLabel={t('common.actions.clear')}
                                        confirmLabel={t(
                                            'common.actions.confirm'
                                        )}
                                        formatValue={formatCompactDateTime}
                                        minuteStep={15}
                                        disabled={{ after: todayDate }}
                                    />
                                </Tooltip>
                            }
                        />
                        <ToolbarActions>
                            <ToolbarRefreshButton
                                onRefresh={() =>
                                    setReloadNonce((value) => value + 1)
                                }
                                loading={loading || refreshing}
                                disabled={!ownerUserId}
                            />
                            <ToolbarOverflowMenu>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        variant="destructive"
                                        disabled={!items.length}
                                        onClick={() => void clearHistory()}
                                    >
                                        <Trash2Icon data-icon="inline-start" />
                                        {t(
                                            filter === 'all'
                                                ? 'browse_history.actions.clear_all'
                                                : 'browse_history.actions.clear_kind'
                                        )}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </ToolbarOverflowMenu>
                        </ToolbarActions>
                    </PageToolbarRow>
                </PageToolbar>
                <TabsContent
                    value={filter}
                    className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
                >
                    {loading ? (
                        <LoadingState label={t('browse_history.loading')} />
                    ) : loadError ? (
                        <EmptyState
                            icon={FootprintsIcon}
                            title={t('browse_history.load_error')}
                        >
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    setReloadNonce((value) => value + 1)
                                }
                            >
                                {t('common.action.retry')}
                            </Button>
                        </EmptyState>
                    ) : !items.length ? (
                        <EmptyState
                            icon={FootprintsIcon}
                            title={t(
                                isFiltered
                                    ? 'browse_history.no_results_title'
                                    : 'browse_history.empty_title'
                            )}
                            description={t(
                                isFiltered
                                    ? 'browse_history.no_results_description'
                                    : 'browse_history.empty_description'
                            )}
                        />
                    ) : (
                        <div
                            ref={viewportRef}
                            className={cn(
                                'min-h-0 flex-1 overflow-y-auto pr-1 transition-opacity duration-150 ease-out',
                                refreshing && 'pointer-events-none opacity-60'
                            )}
                        >
                            <div
                                className="relative"
                                style={{ height: positioned.totalHeight }}
                            >
                                {visibleRows.map((row) => (
                                    <div
                                        key={row.key}
                                        className={cn(
                                            'absolute right-0 left-0',
                                            row.kind === 'cards' && 'grid'
                                        )}
                                        style={{
                                            top: row.top,
                                            height: row.height,
                                            ...(row.kind === 'cards'
                                                ? {
                                                      gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                                                      gap: BROWSE_HISTORY_GRID_GAP
                                                  }
                                                : {})
                                        }}
                                    >
                                        {row.kind === 'heading' ? (
                                            <div className="flex h-full items-center gap-3 px-1">
                                                <h2 className="text-muted-foreground shrink-0 text-xs font-medium tracking-wide tabular-nums">
                                                    {dayLabel(row.dayKey)}
                                                </h2>
                                                <Separator className="flex-1 opacity-60" />
                                            </div>
                                        ) : (
                                            row.items.map(
                                                (
                                                    item: BrowseHistoryItemOutput
                                                ) => (
                                                    <BrowseHistoryCard
                                                        key={`${item.entityKind}:${item.entityId}`}
                                                        item={item}
                                                        onRemove={removeItem}
                                                    />
                                                )
                                            )
                                        )}
                                    </div>
                                ))}
                            </div>
                            {loadingMore ? (
                                <p className="text-muted-foreground py-2 text-center text-xs">
                                    {t('browse_history.loading')}
                                </p>
                            ) : null}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </PageScaffold>
    );
}
