import {
    ChevronsUpDownIcon,
    ChevronUpIcon,
    RefreshCwIcon,
    UserRoundIcon
} from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { DateTimeRangePicker } from '@/components/date-time-range-picker/DateTimeRangePicker';
import {
    createdTime,
    rowLocation,
    rowSearchText,
    sortPreviousInstanceRows
} from '@/components/dialogs/previous-instances-table/previousInstancesRows';
import { PreviousInstanceDetailsPanel } from '@/components/dialogs/previous-instances-table/PreviousInstancesViewParts';
import {
    PageBody,
    PageDescription,
    PageHeader,
    PageScaffold,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { normalizeEndpoint, normalizeUserId } from '@/domain/users/userFacts';
import type { UserFact } from '@/domain/users/userFacts';
import { UserPickerRow } from '@/features/charts/components/MutualFriendsViewParts';
import { InstanceActivityDateControls } from '@/features/instance-history/components/InstanceActivityDateControls';
import { InstanceActivitySettingsPopover } from '@/features/instance-history/components/InstanceActivitySettingsPopover';
import { InstanceHistoryList } from '@/features/instance-history/components/InstanceHistoryList';
import {
    buildChartRows,
    buildDetailGroups,
    filterDetailGroups,
    getDetailGroupKeys
} from '@/features/instance-history/instance-activity/instanceActivityRows';
import type {
    InstanceActivityChartRow,
    PreviousInstanceRow
} from '@/features/instance-history/instance-activity/instanceActivityTypes';
import { useInstanceActivityChartLifecycle } from '@/features/instance-history/instance-activity/useInstanceActivityChartLifecycle';
import { useInstanceActivityData } from '@/features/instance-history/instance-activity/useInstanceActivityData';
import { useInstanceActivityRuntime } from '@/features/instance-history/instance-activity/useInstanceActivityRuntime';
import { useInstanceActivitySettings } from '@/features/instance-history/instance-activity/useInstanceActivitySettings';
import {
    activityRowKey,
    buildAvailableInstanceHistoryDays,
    filterPreviousInstanceRowsForDay,
    findActivityRowForPreviousInstanceRow,
    findPreviousInstanceRowForActivityRow,
    sanitizeInstanceHistoryMode,
    selectDefaultInstanceHistoryDay
} from '@/features/instance-history/instanceHistoryDayMode';
import { formatCompactDateTime, timeToText } from '@/lib/dateTime';
import gameLogRepository from '@/repositories/gameLogRepository';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Spinner } from '@/ui/shadcn/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

type KnownUserOption = Partial<UserFact> & {
    id: string;
    endpoint: string;
    name?: string;
};

type TargetOption = {
    value: string;
    label: string;
    user: KnownUserOption;
};

type PreviousInstanceSortKey = 'date' | 'location' | 'duration';

function rowsFromResult(result: unknown): PreviousInstanceRow[] {
    if (result instanceof Set || result instanceof Map) {
        return Array.from(result.values()).filter(
            (row): row is PreviousInstanceRow =>
                Boolean(row && typeof row === 'object')
        );
    }
    return Array.isArray(result)
        ? result.filter((row): row is PreviousInstanceRow =>
              Boolean(row && typeof row === 'object')
          )
        : [];
}

function knownUserName(user: Partial<KnownUserOption> | null | undefined) {
    return user?.displayName || user?.username || user?.name || '';
}

function dateRangeContains(
    row: PreviousInstanceRow,
    from: Date | null,
    to: Date | null
) {
    if (!from && !to) {
        return true;
    }
    const value = createdTime(row);
    if (!value) {
        return false;
    }
    if (from && value < from.getTime()) {
        return false;
    }
    if (to && value > to.getTime()) {
        return false;
    }
    return true;
}

export function InstanceHistoryPage({
    embedded = false
}: { embedded?: boolean } = {}) {
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const confirm = useModalStore((state) => state.confirm);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserDisplayName = useRuntimeStore(
        (state) => state.auth.currentUserDisplayName
    );
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const usersByKey = useUserFactsStore((state) => state.usersByKey);
    const mode = sanitizeInstanceHistoryMode(searchParams.get('mode'));
    const isDayMode = mode === 'day';
    const [targetPickerOpen, setTargetPickerOpen] = useState(false);
    const [targetSearch, setTargetSearch] = useState('');
    const [rows, setRows] = useState<PreviousInstanceRow[]>([]);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [dateRange, setDateRange] = useState<{
        from: Date | null;
        to: Date | null;
    }>({ from: null, to: null });
    const [sortKey, setSortKey] = useState<PreviousInstanceSortKey>('date');
    const [sortDesc, setSortDesc] = useState(true);
    const [pageSize, setPageSize] = useState(25);
    const [pageIndex, setPageIndex] = useState(0);
    const [detailRow, setDetailRow] = useState<PreviousInstanceRow | null>(
        null
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [selectedDay, setSelectedDay] = useState('');
    const endpoint = normalizeEndpoint(currentEndpoint);
    const paramUserId = normalizeUserId(searchParams.get('id'));
    const activeUserId = paramUserId || normalizeUserId(currentUserId);
    const isSelfScope = activeUserId === normalizeUserId(currentUserId);
    const activityRuntime = useInstanceActivityRuntime(activeUserId);
    const activitySettings = useInstanceActivitySettings();
    const selectedDayForData = selectedDay || '';
    const activityData = useInstanceActivityData({
        currentEndpoint,
        currentUserId: isDayMode ? activeUserId : '',
        reloadToken,
        selectedDate: isDayMode ? selectedDayForData : ''
    });

    const knownUsers = useMemo(() => {
        const usersById = new Map<string, KnownUserOption>();
        if (currentUserId) {
            usersById.set(currentUserId, {
                id: currentUserId,
                displayName: currentUserDisplayName,
                endpoint
            });
        }
        for (const user of Object.values(usersByKey || {}).filter((user) => {
            const userId = normalizeUserId(user?.id);
            return (
                userId &&
                normalizeEndpoint(user?.endpoint || endpoint) === endpoint
            );
        })) {
            const userId = normalizeUserId(user?.id);
            if (!usersById.has(userId)) {
                usersById.set(userId, user);
            }
        }
        return Array.from(usersById.values())
            .sort((left, right) =>
                (knownUserName(left) || left?.id || '').localeCompare(
                    knownUserName(right) || right?.id || ''
                )
            )
            .slice(0, 500);
    }, [currentUserDisplayName, currentUserId, endpoint, usersByKey]);

    const activeKnownUser = useMemo<KnownUserOption | null>(
        () =>
            knownUsers.find(
                (user) => normalizeUserId(user?.id) === activeUserId
            ) || null,
        [activeUserId, knownUsers]
    );

    const activeUserLabel =
        (activeUserId && activeUserId === normalizeUserId(currentUserId)
            ? t('view.instance_history.label.self')
            : knownUserName(activeKnownUser)) ||
        (activeUserId === currentUserId ? currentUserDisplayName : '') ||
        t('view.instance_history.label.selected_user');

    const targetOptions = useMemo(() => {
        const query = targetSearch.trim().toLowerCase();
        return knownUsers
            .map(
                (user): TargetOption => ({
                    value: normalizeUserId(user?.id),
                    label:
                        normalizeUserId(user?.id) ===
                        normalizeUserId(currentUserId)
                            ? t('view.instance_history.label.self')
                            : knownUserName(user) ||
                              t('view.instance_history.label.unnamed_user'),
                    user
                })
            )
            .filter((option) => {
                if (!option.value) {
                    return false;
                }
                if (!query) {
                    return true;
                }
                return (
                    option.label.toLowerCase().includes(query) ||
                    option.value.toLowerCase().includes(query)
                );
            });
    }, [currentUserId, knownUsers, targetSearch, t]);

    const fallbackAvailableDays = useMemo(
        () => buildAvailableInstanceHistoryDays(rows),
        [rows]
    );
    const availableDays = activityData.availableDates.length
        ? activityData.availableDates
        : fallbackAvailableDays;
    const resolvedSelectedDay = selectDefaultInstanceHistoryDay(
        selectedDay,
        availableDays
    );
    const rawDayRows = useMemo(
        () => filterPreviousInstanceRowsForDay(rows, resolvedSelectedDay),
        [resolvedSelectedDay, rows]
    );
    const rawChartRows = useMemo(
        () =>
            buildChartRows(
                activityData.rawRows,
                resolvedSelectedDay,
                activeUserId,
                activityData.worldDetailsById
            ),
        [
            activeUserId,
            activityData.rawRows,
            activityData.worldDetailsById,
            resolvedSelectedDay
        ]
    );
    const detailGroups = useMemo(
        () =>
            buildDetailGroups(
                activityData.rawRows,
                rawChartRows,
                activeUserId,
                activityRuntime.friendIdSet,
                activityRuntime.favoriteIdSet
            ),
        [
            activeUserId,
            activityData.rawRows,
            activityRuntime.favoriteIdSet,
            activityRuntime.friendIdSet,
            rawChartRows
        ]
    );
    const visibleDetailGroups = useMemo(
        () =>
            filterDetailGroups(detailGroups, {
                isDetailVisible: true,
                isSoloInstanceVisible: activitySettings.isSoloInstanceVisible,
                isNoFriendInstanceVisible:
                    activitySettings.isNoFriendInstanceVisible
            }),
        [
            activitySettings.isNoFriendInstanceVisible,
            activitySettings.isSoloInstanceVisible,
            detailGroups
        ]
    );
    const visibleActivityKeySet = useMemo(() => {
        const keys = new Set<string>();
        for (const group of visibleDetailGroups) {
            for (const key of getDetailGroupKeys(group, activeUserId)) {
                keys.add(key);
            }
        }
        return keys;
    }, [activeUserId, visibleDetailGroups]);
    const chartRows = useMemo(() => {
        if (activitySettings.isChartCollapsed || !rawChartRows.length) {
            return [];
        }
        if (!detailGroups.length) {
            return rawChartRows;
        }
        return rawChartRows.filter((row) =>
            visibleActivityKeySet.has(activityRowKey(row))
        );
    }, [
        activitySettings.isChartCollapsed,
        detailGroups.length,
        rawChartRows,
        visibleActivityKeySet
    ]);
    const totalOnlineTime = useMemo(
        () =>
            rawChartRows.reduce(
                (total, row) => total + row.visibleDurationMs,
                0
            ),
        [rawChartRows]
    );
    const selectedActivityKey = detailRow
        ? findActivityRowForPreviousInstanceRow(detailRow, chartRows)
              ?.activityKey || ''
        : '';

    useEffect(() => {
        setPageIndex(0);
    }, [dateRange.from, dateRange.to, search, sortDesc, sortKey]);

    useEffect(() => {
        if (mode !== 'day') {
            return;
        }
        if (resolvedSelectedDay && resolvedSelectedDay !== selectedDay) {
            setSelectedDay(resolvedSelectedDay);
        }
    }, [mode, resolvedSelectedDay, selectedDay]);

    useEffect(() => {
        if (!activeUserId) {
            setRows([]);
            setStatus('idle');
            setError('');
            setDetailRow(null);
            return undefined;
        }

        let active = true;
        setStatus('running');
        setError('');
        setDetailRow(null);

        gameLogRepository
            .getPreviousInstancesByUserId({ id: activeUserId })
            .then((result: unknown) => {
                if (!active) {
                    return;
                }
                setRows(rowsFromResult(result));
                setStatus('ready');
            })
            .catch((loadError: unknown) => {
                if (!active) {
                    return;
                }
                setRows([]);
                setStatus('error');
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : t(
                              'view.instance_history.toast.failed_to_load_instance_history'
                          )
                );
            });

        return () => {
            active = false;
        };
    }, [activeUserId, reloadToken, t]);

    const filteredRows = useMemo(() => {
        const query = search.trim().toLowerCase();
        const dateRows = rows.filter((row) =>
            dateRangeContains(row, dateRange.from, dateRange.to)
        );
        const nextRows = query
            ? dateRows.filter((row) => rowSearchText(row).includes(query))
            : dateRows;
        return sortPreviousInstanceRows(nextRows, sortKey, sortDesc);
    }, [dateRange.from, dateRange.to, rows, search, sortDesc, sortKey]);

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPageIndex = Math.min(pageIndex, totalPages - 1);
    const visibleRows = filteredRows.slice(
        currentPageIndex * pageSize,
        currentPageIndex * pageSize + pageSize
    );

    function selectSort(nextKey: PreviousInstanceSortKey, nextDesc: boolean) {
        setSortKey(nextKey);
        setSortDesc(Boolean(nextDesc));
    }

    function commitSearchParams({
        nextMode = mode,
        nextUserId = activeUserId
    }: {
        nextMode?: typeof mode;
        nextUserId?: string;
    }) {
        const params = new URLSearchParams();
        if (nextMode === 'day') {
            params.set('mode', 'day');
        }
        if (nextUserId && nextUserId !== normalizeUserId(currentUserId)) {
            params.set('scope', 'user');
            params.set('id', nextUserId);
        }
        setSearchParams(params);
    }

    function changeMode(nextMode: string) {
        const sanitizedMode = sanitizeInstanceHistoryMode(nextMode);
        commitSearchParams({ nextMode: sanitizedMode });
    }

    function applyTarget(value: string | null) {
        const nextUserId = normalizeUserId(value);
        if (!nextUserId) {
            return;
        }
        commitSearchParams({ nextUserId });
    }

    function refresh() {
        if (!activeUserId) {
            return;
        }
        setReloadToken((value) => value + 1);
    }

    function clearDateRange() {
        setDateRange({ from: null, to: null });
    }

    function handleSearchChange(value: string) {
        setSearch(value);
        setPageIndex(0);
    }

    function handlePageSizeChange(value: number) {
        setPageSize(value);
        setPageIndex(0);
    }

    function handlePreviousPage() {
        setPageIndex((value) => Math.max(0, value - 1));
    }

    function handleNextPage() {
        setPageIndex((value) => Math.min(totalPages - 1, value + 1));
    }

    const handleActivityRowActivate = useCallback(
        (activityRow: InstanceActivityChartRow) => {
            const matchedRow = findPreviousInstanceRowForActivityRow(
                activityRow,
                rawDayRows
            );
            if (matchedRow) {
                setDetailRow(matchedRow);
            }
        },
        [rawDayRows]
    );

    const activityChartLifecycle = useInstanceActivityChartLifecycle({
        barWidth: activitySettings.barWidth,
        chartRows,
        hour12: activityRuntime.hour12,
        onRowActivate: handleActivityRowActivate,
        resolvedTheme: activityRuntime.resolvedTheme,
        selectedActivityKey,
        selectedDate: resolvedSelectedDay
    });

    const dateActive = Boolean(dateRange.from || dateRange.to);

    const dateRangeLabel = dateActive
        ? [
              dateRange.from ? formatCompactDateTime(dateRange.from) : '...',
              dateRange.to ? formatCompactDateTime(dateRange.to) : '...'
          ].join(' - ')
        : t('view.instance_history.label.date_range');

    const dateRangeControl = (
        <DateTimeRangePicker
            value={dateRange}
            onChange={setDateRange}
            triggerClassName="w-full"
            placeholder={t('view.instance_history.label.date_range')}
            startLabel={t('view.instance_history.label.start')}
            endLabel={t('view.instance_history.label.end')}
            clearLabel={t('common.actions.clear')}
            confirmLabel={t('common.actions.confirm')}
            formatValue={formatCompactDateTime}
            minuteStep={15}
            disabled={{ after: new Date() }}
        />
    );

    async function deleteRow(row: PreviousInstanceRow) {
        const location = rowLocation(row);
        if (!location || !activeUserId) {
            return;
        }
        const result = await confirm({
            title: t(
                'dialog.previous_instances_table.modal.delete_instance_record'
            ),
            description: location,
            destructive: true,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        if (!Array.isArray(row.events) || row.events.length === 0) {
            toast.error(
                t(
                    'dialog.previous_instances.error.this_user_instance_row_cannot_be_deleted_without_event_ids'
                )
            );
            return;
        }
        try {
            await gameLogRepository.deleteGameLogInstance({
                id: activeUserId,
                location,
                events: row.events
            });
            setRows((currentRows) =>
                currentRows.filter((item) => item !== row)
            );
            setDetailRow((current) => (current === row ? null : current));
            setReloadToken((value) => value + 1);
            toast.success(
                t('dialog.previous_instances.success.instance_record_deleted')
            );
        } catch (deleteError) {
            toast.error(
                deleteError instanceof Error
                    ? deleteError.message
                    : t(
                          'dialog.previous_instances_table.toast.failed_to_delete_instance_record'
                      )
            );
        }
    }

    const listVisibleRows = isDayMode ? rawDayRows : visibleRows;
    const listTotalCount = isDayMode ? rawDayRows.length : rows.length;
    const listFilteredCount = isDayMode
        ? rawDayRows.length
        : filteredRows.length;
    const dayStatus = activityData.dataStatus;
    const dayHasChartRows = chartRows.length > 0;
    const instanceHistoryListProps = {
        mode,
        totalCount: listTotalCount,
        filteredCount: listFilteredCount,
        visibleRows: listVisibleRows,
        selectedRow: detailRow,
        search,
        onSearchChange: handleSearchChange,
        pageSize,
        onPageSizeChange: handlePageSizeChange,
        sortKey,
        sortDesc,
        onSortSelect: selectSort,
        currentPageIndex,
        totalPages,
        onPreviousPage: handlePreviousPage,
        onNextPage: handleNextPage,
        onOpenDetails: setDetailRow,
        onDeleteRow: deleteRow,
        dateRangeControl,
        dateActive,
        dateRangeLabel,
        onClearDate: clearDateRange
    };

    return (
        <PageScaffold embedded={embedded}>
            <PageToolbar>
                <PageHeader className="p-0">
                    <PageTitle>{t('view.instance_history.title')}</PageTitle>
                    <PageDescription>
                        {activeUserId
                            ? t('view.instance_history.description.viewing', {
                                  name: activeUserLabel
                              })
                            : t(
                                  'view.instance_history.description.no_current_user'
                              )}
                    </PageDescription>
                </PageHeader>
                <PageToolbarRow>
                    <Popover
                        open={targetPickerOpen}
                        onOpenChange={setTargetPickerOpen}
                    >
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                className="max-w-xl min-w-64 flex-1 justify-between"
                            >
                                <span className="truncate">
                                    {activeUserLabel}
                                </span>
                                <ChevronsUpDownIcon className="text-muted-foreground size-4" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-96 p-2">
                            <div className="flex flex-col gap-2">
                                <Input
                                    value={targetSearch}
                                    onChange={(
                                        event: ChangeEvent<HTMLInputElement>
                                    ) => setTargetSearch(event.target.value)}
                                    placeholder={t(
                                        'view.instance_history.placeholder.user'
                                    )}
                                />
                                <ScrollArea className="h-72 rounded-md border">
                                    <div className="flex flex-col gap-1 p-1 pr-2">
                                        {targetOptions.map((option) => (
                                            <Button
                                                key={option.value}
                                                type="button"
                                                variant="ghost"
                                                className="h-auto justify-start p-0"
                                                onClick={() => {
                                                    applyTarget(option.value);
                                                    setTargetPickerOpen(false);
                                                }}
                                            >
                                                <UserPickerRow
                                                    option={option}
                                                    selected={
                                                        option.value ===
                                                        activeUserId
                                                    }
                                                />
                                            </Button>
                                        ))}
                                        {!targetOptions.length ? (
                                            <div className="text-muted-foreground p-3 text-xs">
                                                {t('common.search_no_results')}
                                            </div>
                                        ) : null}
                                    </div>
                                </ScrollArea>
                            </div>
                        </PopoverContent>
                    </Popover>
                    {!isSelfScope ? (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={!currentUserId}
                            onClick={() => applyTarget(currentUserId)}
                        >
                            <UserRoundIcon data-icon="inline-start" />
                            {t('view.instance_history.action.current_user')}
                        </Button>
                    ) : null}
                    <ToggleGroup
                        type="single"
                        value={mode}
                        onValueChange={(value: string) => {
                            if (value) {
                                changeMode(value);
                            }
                        }}
                        className="shrink-0"
                    >
                        <ToggleGroupItem value="search">
                            {t('view.instance_history.mode.search')}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="day">
                            {t('view.instance_history.mode.day')}
                        </ToggleGroupItem>
                    </ToggleGroup>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!activeUserId || status === 'running'}
                        onClick={refresh}
                    >
                        {status === 'running' ? (
                            <Spinner className="size-4" />
                        ) : (
                            <RefreshCwIcon data-icon="inline-start" />
                        )}
                        {t('common.actions.refresh')}
                    </Button>
                </PageToolbarRow>
                {status === 'error' ? (
                    <div className="text-destructive text-sm">{error}</div>
                ) : null}
            </PageToolbar>
            <PageBody>
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                    {isDayMode ? (
                        <div className="flex shrink-0 flex-col gap-3 rounded-md border p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-3">
                                    <InstanceActivityDateControls
                                        selectedDate={resolvedSelectedDay}
                                        onSelectedDateChange={setSelectedDay}
                                        availableDates={availableDays}
                                        dataStatus={dayStatus}
                                    />
                                    <div className="flex items-baseline gap-2 text-sm">
                                        <span className="text-muted-foreground">
                                            {t(
                                                'view.charts.instance_activity.online_time'
                                            )}
                                        </span>
                                        <span className="font-medium tabular-nums">
                                            {timeToText(totalOnlineTime, true)}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <InstanceActivitySettingsPopover
                                        barWidth={activitySettings.barWidth}
                                        isDetailVisible
                                        isSoloInstanceVisible={
                                            activitySettings.isSoloInstanceVisible
                                        }
                                        isNoFriendInstanceVisible={
                                            activitySettings.isNoFriendInstanceVisible
                                        }
                                        showDetailControl={false}
                                        onBarWidthCommit={
                                            activitySettings.handleBarWidthCommit
                                        }
                                        onSoloInstanceVisibleChange={
                                            activitySettings.setSoloInstanceVisible
                                        }
                                        onNoFriendInstanceVisibleChange={
                                            activitySettings.setNoFriendInstanceVisible
                                        }
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={t(
                                            activitySettings.isChartCollapsed
                                                ? 'view.instance_history.day.expand_chart'
                                                : 'view.instance_history.day.collapse_chart'
                                        )}
                                        onClick={() =>
                                            activitySettings.setChartCollapsed(
                                                !activitySettings.isChartCollapsed
                                            )
                                        }
                                    >
                                        <ChevronUpIcon
                                            data-icon="icon"
                                            className={
                                                activitySettings.isChartCollapsed
                                                    ? 'rotate-180'
                                                    : ''
                                            }
                                        />
                                    </Button>
                                </div>
                            </div>
                            {activitySettings.isChartCollapsed ? null : dayStatus ===
                              'running' ? (
                                <div className="text-muted-foreground flex min-h-24 items-center justify-center gap-2 text-sm">
                                    <Spinner className="size-4" />
                                    {t(
                                        'view.charts.loading.loading_instance_activity'
                                    )}
                                </div>
                            ) : dayStatus === 'error' ? (
                                <div className="text-destructive text-sm">
                                    {activityData.dataDetail ||
                                        t(
                                            'view.charts.error.instance_activity_failed_to_load'
                                        )}
                                </div>
                            ) : (
                                <>
                                    <div
                                        ref={
                                            activityChartLifecycle.setMainChartElementRef
                                        }
                                        className="min-h-24 w-full bg-transparent"
                                    />
                                    {!dayHasChartRows ? (
                                        <div className="text-muted-foreground text-sm">
                                            {t(
                                                'view.charts.empty.no_instance_activity_on_this_day'
                                            )}
                                        </div>
                                    ) : null}
                                </>
                            )}
                        </div>
                    ) : null}
                    <ResizablePanelGroup
                        id="instance-history-layout"
                        orientation="horizontal"
                        className="min-h-0 flex-1"
                    >
                        <ResizablePanel
                            id="instance-history-list"
                            defaultSize={36}
                            minSize={28}
                            className="min-h-0 min-w-0 pr-3"
                        >
                            <InstanceHistoryList
                                {...instanceHistoryListProps}
                            />
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel
                            id="instance-history-details"
                            defaultSize={64}
                            minSize={40}
                            className="min-h-0 min-w-0 pl-3"
                        >
                            <PreviousInstanceDetailsPanel
                                row={detailRow}
                                showTitle
                                className="h-full min-h-0"
                            />
                        </ResizablePanel>
                    </ResizablePanelGroup>
                </div>
            </PageBody>
        </PageScaffold>
    );
}
