import {
    CalendarRangeIcon,
    ChevronsUpDownIcon,
    ChevronUpIcon,
    UserRoundIcon
} from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import {
    DateTimeRangePicker,
    type DateTimeRangeValue
} from '@/components/date-time-range-picker/DateTimeRangePicker';
import { PreviousInstanceDetailsPanel } from '@/components/dialogs/previous-instances-table/PreviousInstancesViewParts';
import {
    PageBody,
    PageScaffold,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarRefreshButton,
    ToolbarSearch,
    ToolbarSegmented,
    ToolbarStatus,
    ToolbarViewMenu,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import { UserPickerRow } from '@/components/search/UserPickerRow';
import { normalizeEndpoint, normalizeUserId } from '@/domain/users/userFacts';
import type { UserFact } from '@/domain/users/userFacts';
import { InstanceActivityDateControls } from '@/features/instance-history/components/InstanceActivityDateControls';
import { InstanceActivitySettingsPopover } from '@/features/instance-history/components/InstanceActivitySettingsPopover';
import { InstanceHistoryList } from '@/features/instance-history/components/InstanceHistoryList';
import {
    buildChartRows,
    buildDetailGroups,
    filterDetailGroups,
    getDetailGroupKeys
} from '@/features/instance-history/instance-activity/instanceActivityRows';
import type { InstanceActivityChartRow } from '@/features/instance-history/instance-activity/instanceActivityTypes';
import { useInstanceActivityChartLifecycle } from '@/features/instance-history/instance-activity/useInstanceActivityChartLifecycle';
import { useInstanceActivityData } from '@/features/instance-history/instance-activity/useInstanceActivityData';
import { useInstanceActivityRuntime } from '@/features/instance-history/instance-activity/useInstanceActivityRuntime';
import { useInstanceActivitySettings } from '@/features/instance-history/instance-activity/useInstanceActivitySettings';
import {
    emptyInstanceHistoryDateRange,
    isEmptyInstanceHistoryDateRange,
    refreshDefaultInstanceHistoryDateRange,
    resolveClearedInstanceHistoryDateRange,
    resolveScopedInstanceHistoryDateRange,
    type InstanceHistoryDateRangeState
} from '@/features/instance-history/instanceHistoryDateRange';
import {
    activityRowKey,
    filterPreviousInstanceRowsForDay,
    findActivityRowForPreviousInstanceRow,
    findPreviousInstanceRowForActivityRow,
    sanitizeInstanceHistoryMode
} from '@/features/instance-history/instanceHistoryDayMode';
import { formatCompactDateTime, timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';
import { Button } from '@/ui/shadcn/button';
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Separator } from '@/ui/shadcn/separator';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';

import {
    buildInstanceHistorySearchParams,
    filterAndSortInstanceHistoryRows,
    type InstanceHistorySortKey
} from './instanceHistoryController';
import { useInstanceHistoryRowsController } from './useInstanceHistoryRowsController';

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

const CHART_LOADING_INDICATOR_DELAY_MS = 150;

function knownUserName(user: Partial<KnownUserOption> | null | undefined) {
    return user?.displayName || user?.username || user?.name || '';
}

function instanceHistoryDateRangeTrigger({
    active,
    label
}: {
    active: boolean;
    label: string;
}) {
    return (
        <Button
            type="button"
            variant={active ? 'secondary' : 'outline'}
            aria-label={label}
            className="max-w-56 shrink-0"
        >
            <CalendarRangeIcon data-icon="inline-start" />
            <span className="truncate">{label}</span>
        </Button>
    );
}

export function InstanceHistoryPage({
    embedded = false
}: { embedded?: boolean } = {}) {
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
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
    const [search, setSearch] = useState('');
    const [dateRangeState, setDateRangeState] =
        useState<InstanceHistoryDateRangeState>(() => ({
            range: emptyInstanceHistoryDateRange(),
            source: 'none'
        }));
    const [sortKey, setSortKey] = useState<InstanceHistorySortKey>('date');
    const [sortDesc, setSortDesc] = useState(true);
    const [reloadToken, setReloadToken] = useState(0);
    const [selectedDay, setSelectedDay] = useState('');
    const [showChartLoadingIndicator, setShowChartLoadingIndicator] =
        useState(false);
    const targetSearchInputRef = useRef<HTMLInputElement>(null);
    const endpoint = normalizeEndpoint(currentEndpoint);
    const paramUserId = normalizeUserId(searchParams.get('id'));
    const paramSearch = searchParams.get('q') || '';
    const activeUserId = paramUserId || normalizeUserId(currentUserId);
    const isSelfScope = activeUserId === normalizeUserId(currentUserId);
    const dateRange = dateRangeState.range;
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
        const selfId = normalizeUserId(currentUserId);
        const options = knownUsers
            .map((user): TargetOption => ({
                value: normalizeUserId(user?.id),
                label:
                    normalizeUserId(user?.id) === normalizeUserId(currentUserId)
                        ? t('view.instance_history.label.self')
                        : knownUserName(user) ||
                          t('view.instance_history.label.unnamed_user'),
                user
            }))
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

        const selfIndex = options.findIndex(
            (option) => option.value === selfId
        );
        if (selfIndex > 0) {
            const [selfOption] = options.splice(selfIndex, 1);
            options.unshift(selfOption);
        }
        return options;
    }, [currentUserId, knownUsers, targetSearch, t]);

    const reloadDayData = useCallback(() => {
        setReloadToken((value) => value + 1);
    }, []);
    const historyRows = useInstanceHistoryRowsController({
        activeUserId,
        availableActivityDates: activityData.availableDates,
        dateRangeState,
        endpoint,
        isSelfScope,
        mode,
        reloadDayData,
        reloadToken,
        selectedDay
    });
    const availableDays = historyRows.availableDays;
    const resolvedSelectedDay = historyRows.resolvedSelectedDay;
    const visibleRows = historyRows.rows;
    const visibleStatus = historyRows.status;
    const visibleError = historyRows.error;
    const visibleDetailRow = historyRows.detailRow;
    const setDetailRow = historyRows.setDetailRow;
    const rawDayRows = useMemo(
        () =>
            filterPreviousInstanceRowsForDay(visibleRows, resolvedSelectedDay),
        [resolvedSelectedDay, visibleRows]
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
    useEffect(() => {
        if (!paramSearch) {
            return;
        }
        setSearch(paramSearch);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('q');
        setSearchParams(nextParams, { replace: true });
    }, [paramSearch, searchParams, setSearchParams]);

    const [displayedOnlineTime, setDisplayedOnlineTime] = useState(0);
    useEffect(() => {
        if (activityData.dataStatus !== 'running') {
            setDisplayedOnlineTime(totalOnlineTime);
        }
    }, [activityData.dataStatus, totalOnlineTime]);
    const selectedActivityKey = visibleDetailRow
        ? findActivityRowForPreviousInstanceRow(visibleDetailRow, chartRows)
              ?.activityKey || ''
        : '';

    useEffect(() => {
        if (activityData.dataStatus !== 'running') {
            setShowChartLoadingIndicator(false);
            return undefined;
        }
        const timer = window.setTimeout(() => {
            setShowChartLoadingIndicator(true);
        }, CHART_LOADING_INDICATOR_DELAY_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [activityData.dataStatus]);

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
            return;
        }
        setDateRangeState((currentState) =>
            resolveScopedInstanceHistoryDateRange({
                isDayMode,
                isSelfScope,
                state: currentState
            })
        );
    }, [activeUserId, isDayMode, isSelfScope]);

    const filteredRows = useMemo(
        () =>
            filterAndSortInstanceHistoryRows({
                rows: visibleRows,
                query: search,
                from: dateRange.from,
                to: dateRange.to,
                sortKey,
                sortDesc
            }),
        [dateRange.from, dateRange.to, search, sortDesc, sortKey, visibleRows]
    );

    function selectSort(nextKey: InstanceHistorySortKey, nextDesc: boolean) {
        setSortKey(nextKey);
        setSortDesc(nextDesc);
    }

    function commitSearchParams({
        nextMode = mode,
        nextUserId = activeUserId
    }: {
        nextMode?: typeof mode;
        nextUserId?: string;
    }) {
        setSearchParams(
            buildInstanceHistorySearchParams({
                currentUserId: normalizeUserId(currentUserId),
                mode: nextMode,
                userId: nextUserId
            })
        );
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
        const nextIsSelfScope = nextUserId === normalizeUserId(currentUserId);
        setDateRangeState((currentState) =>
            resolveScopedInstanceHistoryDateRange({
                isDayMode,
                isSelfScope: nextIsSelfScope,
                state: currentState
            })
        );
        commitSearchParams({ nextUserId });
    }

    function refresh() {
        if (!activeUserId) {
            return;
        }
        setDateRangeState((currentState) =>
            refreshDefaultInstanceHistoryDateRange(currentState)
        );
        setReloadToken((value) => value + 1);
    }

    function clearDateRange() {
        setDateRangeState(
            resolveClearedInstanceHistoryDateRange({
                isDayMode,
                isSelfScope
            })
        );
    }

    function handleDateRangeChange(nextRange: DateTimeRangeValue) {
        if (isEmptyInstanceHistoryDateRange(nextRange)) {
            clearDateRange();
            return;
        }
        setDateRangeState({
            range: nextRange,
            source: 'user'
        });
    }

    function handleSearchChange(value: string) {
        setSearch(value);
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
        [rawDayRows, setDetailRow]
    );

    const activityChartLifecycle = useInstanceActivityChartLifecycle({
        barWidth: activitySettings.barWidth,
        chartRows,
        frozen: activityData.dataStatus === 'running',
        hour12: activityRuntime.hour12,
        onRowActivate: handleActivityRowActivate,
        resolvedTheme: activityRuntime.resolvedTheme,
        selectedActivityKey,
        selectedDate: resolvedSelectedDay
    });

    const dateRangeUserSet = dateRangeState.source === 'user';

    const sortItems: { value: InstanceHistorySortKey; label: string }[] = [
        { value: 'date', label: t('table.previous_instances.date') },
        {
            value: 'location',
            label: t('dialog.previous_instances.label.location')
        },
        { value: 'duration', label: t('table.previous_instances.time') }
    ];

    const dateRangeControl = (
        <DateTimeRangePicker
            value={dateRange}
            onChange={handleDateRangeChange}
            align="start"
            renderTrigger={({ label }) =>
                instanceHistoryDateRangeTrigger({
                    active: dateRangeUserSet,
                    label
                })
            }
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

    const listVisibleRows = isDayMode ? rawDayRows : filteredRows;
    const listTotalCount = isDayMode ? rawDayRows.length : visibleRows.length;
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
        selectedRow: visibleDetailRow,
        search,
        onSearchChange: handleSearchChange,
        sortKey,
        onOpenDetails: setDetailRow,
        onDeleteRow: historyRows.deleteRow,
        dateActive: dateRangeUserSet,
        onClearDate: clearDateRange
    };

    return (
        <PageScaffold embedded={embedded}>
            <PageToolbar>
                <PageToolbarRow>
                    <ToolbarViews className="min-w-0 flex-wrap">
                        <Popover
                            open={targetPickerOpen}
                            onOpenChange={setTargetPickerOpen}
                        >
                            <PopoverTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-48 shrink-0 justify-between"
                                    >
                                        <UserRoundIcon
                                            data-icon="inline-start"
                                            className="text-muted-foreground"
                                        />
                                        <span className="min-w-0 flex-1 truncate text-left">
                                            {activeUserLabel}
                                        </span>
                                        <ChevronsUpDownIcon
                                            data-icon="inline-end"
                                            className="text-muted-foreground size-4"
                                        />
                                    </Button>
                                }
                            />
                            <PopoverContent
                                align="start"
                                className="w-96 p-2"
                                initialFocus={targetSearchInputRef}
                            >
                                <div className="flex flex-col gap-2">
                                    <Input
                                        ref={targetSearchInputRef}
                                        value={targetSearch}
                                        onChange={(
                                            event: ChangeEvent<HTMLInputElement>
                                        ) =>
                                            setTargetSearch(event.target.value)
                                        }
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
                                                        applyTarget(
                                                            option.value
                                                        );
                                                        setTargetPickerOpen(
                                                            false
                                                        );
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
                                                    {t(
                                                        'empty_state.search_no_results'
                                                    )}
                                                </div>
                                            ) : null}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </PopoverContent>
                        </Popover>
                        <Separator orientation="vertical" />
                        <ToolbarSegmented
                            value={mode}
                            onValueChange={changeMode}
                            options={[
                                {
                                    value: 'search',
                                    label: t(
                                        'view.instance_history.mode.search'
                                    )
                                },
                                {
                                    value: 'day',
                                    label: t('view.instance_history.mode.day')
                                }
                            ]}
                        />
                        {isDayMode ? (
                            <InstanceActivityDateControls
                                selectedDate={resolvedSelectedDay}
                                onSelectedDateChange={setSelectedDay}
                                availableDates={availableDays}
                                dataStatus={dayStatus}
                            />
                        ) : (
                            <>
                                {dateRangeControl}
                                <ToolbarSearch
                                    value={search}
                                    onValueChange={setSearch}
                                    className="ml-auto w-48 sm:w-56"
                                    placeholder={t(
                                        'dialog.previous_instances.search_placeholder'
                                    )}
                                />
                            </>
                        )}
                    </ToolbarViews>

                    <ToolbarActions>
                        <ToolbarRefreshButton
                            onRefresh={refresh}
                            loading={visibleStatus === 'running'}
                            disabled={!activeUserId}
                        />
                        {isDayMode ? null : (
                            <ToolbarViewMenu contentClassName="p-3">
                                <FieldGroup
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <Field>
                                        <FieldContent>
                                            <FieldLabel>
                                                {t(
                                                    'dialog.previous_instances.label.sort_by'
                                                )}
                                            </FieldLabel>
                                        </FieldContent>
                                        <Select<InstanceHistorySortKey>
                                            value={sortKey}
                                            items={sortItems}
                                            onValueChange={(value) => {
                                                if (value) {
                                                    selectSort(value, sortDesc);
                                                }
                                            }}
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {sortItems.map((item) => (
                                                        <SelectItem
                                                            key={item.value}
                                                            value={item.value}
                                                        >
                                                            {item.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Field orientation="horizontal">
                                        <FieldContent>
                                            <FieldLabel htmlFor="instance-history-sort-desc">
                                                {t(
                                                    'dialog.previous_instances.label.sort_descending'
                                                )}
                                            </FieldLabel>
                                        </FieldContent>
                                        <Switch
                                            id="instance-history-sort-desc"
                                            checked={sortDesc}
                                            onCheckedChange={(checked) =>
                                                selectSort(sortKey, checked)
                                            }
                                        />
                                    </Field>
                                </FieldGroup>
                            </ToolbarViewMenu>
                        )}
                    </ToolbarActions>
                </PageToolbarRow>
                {visibleStatus === 'error' ? (
                    <ToolbarStatus className="text-destructive">
                        {visibleError}
                    </ToolbarStatus>
                ) : null}
            </PageToolbar>
            <PageBody>
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                    {isDayMode ? (
                        <div className="flex shrink-0 flex-col gap-3 rounded-md border p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-baseline gap-2 text-sm">
                                    <span className="text-muted-foreground">
                                        {t(
                                            'view.charts.instance_activity.online_time'
                                        )}
                                    </span>
                                    <span className="font-medium tabular-nums">
                                        {timeToText(displayedOnlineTime, true)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <InstanceActivitySettingsPopover
                                        barWidth={activitySettings.barWidth}
                                        isSoloInstanceVisible={
                                            activitySettings.isSoloInstanceVisible
                                        }
                                        isNoFriendInstanceVisible={
                                            activitySettings.isNoFriendInstanceVisible
                                        }
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
                                            className={cn(
                                                'transition-transform duration-200 ease-out',
                                                activitySettings.isChartCollapsed &&
                                                    'rotate-180'
                                            )}
                                        />
                                    </Button>
                                </div>
                            </div>
                            {activityData.availableDatesStatus === 'error' ? (
                                <div className="text-destructive text-sm">
                                    {activityData.availableDatesError ||
                                        t(
                                            'view.charts.error.instance_activity_failed_to_load'
                                        )}
                                </div>
                            ) : null}
                            {activitySettings.isChartCollapsed ? null : dayStatus ===
                              'error' ? (
                                <div className="text-destructive text-sm">
                                    {activityData.dataDetail ||
                                        t(
                                            'view.charts.error.instance_activity_failed_to_load'
                                        )}
                                </div>
                            ) : (
                                <div className="relative">
                                    <div
                                        ref={
                                            activityChartLifecycle.setMainChartElementRef
                                        }
                                        className={cn(
                                            'min-h-24 w-full bg-transparent',
                                            dayStatus === 'running' &&
                                                'pointer-events-none opacity-60'
                                        )}
                                    />
                                    {dayStatus === 'running' &&
                                    showChartLoadingIndicator ? (
                                        <div className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm">
                                            <Spinner className="size-4" />
                                            {t(
                                                'view.charts.loading.loading_instance_activity'
                                            )}
                                        </div>
                                    ) : null}
                                    {dayStatus !== 'running' &&
                                    !dayHasChartRows ? (
                                        <div className="text-muted-foreground text-sm">
                                            {t(
                                                'view.charts.empty.no_instance_activity_on_this_day'
                                            )}
                                        </div>
                                    ) : null}
                                </div>
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
                            defaultSize={34}
                            minSize={28}
                            className="min-h-0 min-w-0 pr-2"
                        >
                            <InstanceHistoryList
                                {...instanceHistoryListProps}
                            />
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel
                            id="instance-history-details"
                            defaultSize={66}
                            minSize={40}
                            className="min-h-0 min-w-0 pl-2"
                        >
                            <PreviousInstanceDetailsPanel
                                row={visibleDetailRow}
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
