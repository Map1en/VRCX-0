import * as echarts from 'echarts';
import {
    CalendarDaysIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    RefreshCcwIcon,
    Settings2Icon
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog.jsx';
import { Location } from '@/components/Location.jsx';
import { timeToText } from '@/lib/dateTime.js';
import {
    configRepository,
    instanceActivityRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { getResolvedThemeMode } from '@/services/themeService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Separator } from '@/ui/shadcn/separator';
import { Slider } from '@/ui/shadcn/slider';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';

import {
    buildChartOption,
    buildDetailChartOption,
    formatClock
} from './instance-activity/instanceActivityChart.js';
import {
    buildChartRows,
    buildDetailGroups,
    filterDetailGroups,
    getActivityDetailKey,
    getDetailGroupKeys,
    getLocalDayBounds
} from './instance-activity/instanceActivityRows.js';

const DEFAULT_BAR_WIDTH = 25;

function hasWorldName(world) {
    return Boolean(String(world?.name || '').trim());
}

async function loadMissingWorldProfiles(worldIds, worldDetailsById, endpoint) {
    const missingWorldIds = worldIds.filter(
        (worldId) => !hasWorldName(worldDetailsById[worldId])
    );
    if (!missingWorldIds.length) {
        return worldDetailsById;
    }

    const results = await Promise.allSettled(
        missingWorldIds.map((worldId) =>
            worldProfileRepository.getWorldProfile({ worldId, endpoint })
        )
    );
    const nextWorldDetailsById = { ...worldDetailsById };
    for (const result of results) {
        if (result.status !== 'fulfilled' || !hasWorldName(result.value)) {
            continue;
        }
        const worldId = String(result.value.id || '').trim();
        if (!worldId) {
            continue;
        }
        nextWorldDetailsById[worldId] = {
            ...(nextWorldDetailsById[worldId] || {}),
            ...result.value
        };
    }
    return nextWorldDetailsById;
}

function getTodayKey() {
    return toLocalDayKey(new Date());
}

function toLocalDayKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseLocalDayKey(dayKey) {
    const [year, month, day] = String(dayKey || '')
        .split('-')
        .map((value) => Number.parseInt(value, 10) || 0);
    return new Date(year, Math.max(0, month - 1), day || 1, 0, 0, 0, 0);
}

function formatDateLabel(dayKey) {
    try {
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            weekday: 'short'
        }).format(parseLocalDayKey(dayKey));
    } catch {
        return dayKey;
    }
}

function ChartLoadingState() {
    return (
        <div className="bg-muted/20 flex min-h-80 items-center justify-center rounded-xl border border-dashed">
            <div className="text-muted-foreground flex items-center gap-3 text-sm">
                <Spinner className="size-5" />
                <span>Loading instance activity.</span>
            </div>
        </div>
    );
}

function ChartEmptyState({ title, description }) {
    return (
        <div className="bg-muted/20 flex min-h-80 items-center justify-center rounded-xl border border-dashed p-6 text-center">
            <div className="flex max-w-md flex-col gap-2">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-muted-foreground text-sm">
                    {description}
                </div>
            </div>
        </div>
    );
}

function InstanceActivityDetailChart({
    group,
    barWidth,
    hour12,
    resolvedTheme,
    worldDetailsById,
    onOpenPreviousInstanceInfo
}) {
    const chartElementRef = useRef(null);
    const chartInstanceRef = useRef(null);
    const resizeObserverRef = useRef(null);
    const chartThemeRef = useRef(null);

    const setDetailChartElementRef = useCallback((node) => {
        if (chartElementRef.current && chartElementRef.current !== node) {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
            chartThemeRef.current = null;
        }
        chartElementRef.current = node;
    }, []);

    const location = group[0]?.location || '';
    const parsedLocation = parseLocation(location);
    const world = parsedLocation.worldId
        ? worldDetailsById[parsedLocation.worldId]
        : null;
    const worldName = world?.name || '';
    const currentUserEntry = group.find((entry) => entry.isCurrentUser);

    function openPreviousInstanceInfo() {
        if (!location) {
            return;
        }
        const firstEntry = currentUserEntry || group[0] || {};
        const startMs = Number.isFinite(firstEntry.joinMs)
            ? firstEntry.joinMs
            : Math.min(
                  ...group.map((entry) => entry.joinMs).filter(Number.isFinite)
              );
        const endMs = Number.isFinite(firstEntry.leaveMs)
            ? firstEntry.leaveMs
            : Math.max(
                  ...group.map((entry) => entry.leaveMs).filter(Number.isFinite)
              );
        onOpenPreviousInstanceInfo?.({
            location,
            worldName,
            groupName: parsedLocation.groupId || '',
            created_at: Number.isFinite(endMs)
                ? new Date(endMs).toISOString()
                : '',
            time:
                Number.isFinite(startMs) && Number.isFinite(endMs)
                    ? Math.max(0, endMs - startMs)
                    : 0
        });
    }

    useEffect(() => {
        return () => {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!chartElementRef.current || !group.length) {
            return;
        }

        const themeName = resolvedTheme === 'dark' ? 'dark' : null;
        let chart = chartInstanceRef.current;
        if (!chart || chartThemeRef.current !== themeName) {
            resizeObserverRef.current?.disconnect();
            chart?.dispose();

            chart = echarts.init(
                chartElementRef.current,
                themeName || undefined
            );
            chartInstanceRef.current = chart;
            chartThemeRef.current = themeName;
            resizeObserverRef.current = new ResizeObserver(() => {
                chart.resize();
            });
            resizeObserverRef.current.observe(chartElementRef.current);
        }

        const optionWithEntries = buildDetailChartOption({
            group,
            barWidth,
            hour12
        });
        if (!optionWithEntries) {
            chart.clear();
            return;
        }

        const { firstEntries, ...option } = optionWithEntries;
        const chartHeight = Math.max(
            180,
            firstEntries.length * (barWidth + 10) + 110
        );
        chartElementRef.current.style.height = `${chartHeight}px`;
        chart.resize({ height: chartHeight });
        chart.off('click');
        chart.setOption(option, true);
        chart.on('click', (params) => {
            if (params.componentType !== 'yAxis') {
                return;
            }

            const entry = firstEntries[params.dataIndex];
            if (entry?.userId) {
                openUserDialog({
                    userId: entry.userId,
                    title: entry.displayName
                });
            }
        });
    }, [barWidth, group, hour12, resolvedTheme]);

    return (
        <div className="w-full">
            <div className="mt-12 flex h-7 min-w-0 items-center justify-between gap-3 text-sm">
                <div className="min-w-0 flex-1">
                    <Location
                        location={location}
                        hint={worldName}
                        enableContextMenu
                        isOpenPreviousInstanceInfoDialog
                        onShowPreviousInstances={openPreviousInstanceInfo}
                        className="font-medium"
                    />
                </div>
                {currentUserEntry ? (
                    <div className="text-muted-foreground shrink-0">
                        {formatClock(currentUserEntry.joinMs, hour12, true)} -{' '}
                        {formatClock(currentUserEntry.leaveMs, hour12, true)}
                    </div>
                ) : null}
            </div>
            {group.length ? (
                <div ref={setDetailChartElementRef} className="w-full" />
            ) : (
                <ChartEmptyState
                    title="No detail rows"
                    description="No matching player activity rows were found for this instance visit."
                />
            )}
        </div>
    );
}

export function InstanceActivityPage() {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const favoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavoritesList = useFavoriteStore(
        (state) => state.localFriendFavoritesList
    );
    const shellThemeMode = useShellStore((state) => state.themeMode);
    const resolvedTheme = getResolvedThemeMode(shellThemeMode);
    const hour12 = usePreferencesStore((state) => state.dtHour12);

    const [selectedDate, setSelectedDate] = useState(getTodayKey);
    const [availableDates, setAvailableDates] = useState([]);
    const [dataStatus, setDataStatus] = useState('idle');
    const [dataDetail, setDataDetail] = useState('');
    const [rawRows, setRawRows] = useState([]);
    const [worldDetailsById, setWorldDetailsById] = useState({});
    const [barWidth, setBarWidth] = useState(DEFAULT_BAR_WIDTH);
    const [isDetailVisible, setIsDetailVisible] = useState(true);
    const [isSoloInstanceVisible, setIsSoloInstanceVisible] = useState(true);
    const [isNoFriendInstanceVisible, setIsNoFriendInstanceVisible] =
        useState(true);
    const [reloadToken, setReloadToken] = useState(0);
    const [previousInstanceOpen, setPreviousInstanceOpen] = useState(false);
    const [previousInstanceRows, setPreviousInstanceRows] = useState([]);
    const [previousInstanceTitle, setPreviousInstanceTitle] =
        useState('Previous Instance');
    const [mainChartElement, setMainChartElement] = useState(null);

    const chartElementRef = useRef(null);
    const chartInstanceRef = useRef(null);
    const chartThemeRef = useRef(null);
    const resizeObserverRef = useRef(null);
    const detailGroupRefs = useRef(new Map());

    const setMainChartElementRef = useCallback((node) => {
        if (chartElementRef.current && chartElementRef.current !== node) {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
            chartThemeRef.current = null;
        }
        chartElementRef.current = node;
        setMainChartElement(node);
    }, []);

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getInt(
                'InstanceActivityBarWidth',
                DEFAULT_BAR_WIDTH
            ),
            configRepository.getBool(
                'VRCX_InstanceActivityDetailVisible',
                true
            ),
            configRepository.getBool(
                'VRCX_InstanceActivitySoloInstanceVisible',
                true
            ),
            configRepository.getBool(
                'VRCX_InstanceActivityNoFriendInstanceVisible',
                true
            )
        ])
            .then(
                ([
                    nextBarWidth,
                    nextDetailVisible,
                    nextSoloVisible,
                    nextNoFriendVisible
                ]) => {
                    if (!active) {
                        return;
                    }

                    setBarWidth(
                        Number.isFinite(nextBarWidth)
                            ? Math.min(50, Math.max(1, nextBarWidth))
                            : DEFAULT_BAR_WIDTH
                    );
                    setIsDetailVisible(Boolean(nextDetailVisible));
                    setIsSoloInstanceVisible(Boolean(nextSoloVisible));
                    setIsNoFriendInstanceVisible(Boolean(nextNoFriendVisible));
                }
            )
            .catch(() => {});

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            setAvailableDates([]);
            return () => {
                active = false;
            };
        }

        instanceActivityRepository
            .getAvailableDates(currentUserId)
            .then((rows) => {
                if (!active) {
                    return;
                }

                const uniqueDates = Array.from(
                    new Set(
                        rows
                            .map((value) => toLocalDayKey(value))
                            .filter(Boolean)
                    )
                ).sort((left, right) => right.localeCompare(left));
                setAvailableDates(uniqueDates);
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                setDataDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load available instance activity dates.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentUserId, reloadToken]);

    useEffect(() => {
        let active = true;

        if (!currentUserId || !selectedDate) {
            setDataStatus('idle');
            setRawRows([]);
            setWorldDetailsById({});
            return () => {
                active = false;
            };
        }

        const { start, end } = getLocalDayBounds(selectedDate);
        setDataStatus('running');
        setDataDetail('');

        instanceActivityRepository
            .getInstanceActivityRows(start.toISOString(), end.toISOString())
            .then(async (rows) => {
                if (!active) {
                    return;
                }

                const worldIds = Array.from(
                    new Set(
                        rows
                            .map((row) => parseLocation(row.location).worldId)
                            .filter(Boolean)
                    )
                );
                const nextWorldDetailsById =
                    await instanceActivityRepository.getWorldSummariesByIds(
                        worldIds
                    );
                const resolvedWorldDetailsById = await loadMissingWorldProfiles(
                    worldIds,
                    nextWorldDetailsById,
                    currentEndpoint
                );

                if (!active) {
                    return;
                }

                setRawRows(Array.isArray(rows) ? rows : []);
                setWorldDetailsById(resolvedWorldDetailsById);
                setDataStatus('ready');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                setRawRows([]);
                setWorldDetailsById({});
                setDataStatus('error');
                setDataDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load instance activity for the selected day.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId, selectedDate, reloadToken]);

    useEffect(() => {
        return () => {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
        };
    }, []);

    const chartRows = useMemo(
        () =>
            buildChartRows(
                rawRows,
                selectedDate,
                currentUserId,
                worldDetailsById
            ),
        [currentUserId, rawRows, selectedDate, worldDetailsById]
    );

    const friendIdSet = useMemo(
        () => new Set(Object.keys(friendsById)),
        [friendsById]
    );
    const favoriteIdSet = useMemo(
        () =>
            new Set([
                ...(favoriteFriendIds || []),
                ...(localFriendFavoritesList || [])
            ]),
        [favoriteFriendIds, localFriendFavoritesList]
    );

    const detailGroups = useMemo(
        () =>
            buildDetailGroups(
                rawRows,
                chartRows,
                currentUserId,
                friendIdSet,
                favoriteIdSet
            ),
        [chartRows, currentUserId, favoriteIdSet, friendIdSet, rawRows]
    );

    const filteredDetailGroups = useMemo(
        () =>
            filterDetailGroups(detailGroups, {
                isDetailVisible,
                isSoloInstanceVisible,
                isNoFriendInstanceVisible
            }),
        [
            detailGroups,
            isDetailVisible,
            isNoFriendInstanceVisible,
            isSoloInstanceVisible
        ]
    );

    const totalOnlineTime = useMemo(
        () =>
            chartRows.reduce((total, row) => total + row.visibleDurationMs, 0),
        [chartRows]
    );

    const sortedDatesDesc = useMemo(
        () =>
            [...availableDates].sort((left, right) =>
                right.localeCompare(left)
            ),
        [availableDates]
    );

    const earliestDate = sortedDatesDesc[sortedDatesDesc.length - 1] || null;
    const latestDate = sortedDatesDesc[0] || null;
    const selectedDateIndex = sortedDatesDesc.findIndex(
        (value) => value === selectedDate
    );
    const dateOptions = useMemo(() => {
        const options = [...sortedDatesDesc];
        if (selectedDate && !options.includes(selectedDate)) {
            options.unshift(selectedDate);
        }
        return options;
    }, [selectedDate, sortedDatesDesc]);

    const isNextDayDisabled = !latestDate || selectedDate >= latestDate;
    const isPrevDayDisabled = !earliestDate || selectedDate === earliestDate;

    useEffect(() => {
        if (!mainChartElement) {
            return;
        }

        const themeName = resolvedTheme === 'dark' ? 'dark' : null;
        let chart = chartInstanceRef.current;

        if (!chart || chartThemeRef.current !== themeName) {
            resizeObserverRef.current?.disconnect();
            chart?.dispose();

            chart = echarts.init(mainChartElement, themeName || undefined);
            chartInstanceRef.current = chart;
            chartThemeRef.current = themeName;

            resizeObserverRef.current = new ResizeObserver(() => {
                chart.resize();
            });
            resizeObserverRef.current.observe(mainChartElement);
        }

        const chartHeight = Math.max(
            220,
            chartRows.length * (barWidth + 10) + 200
        );
        mainChartElement.style.height = `${chartHeight}px`;
        chart.resize({ height: chartHeight });
        chart.off('click');

        if (!chartRows.length) {
            chart.clear();
            return;
        }

        chart.setOption(
            buildChartOption({
                rows: chartRows,
                selectedDate,
                barWidth,
                hour12,
                t
            }),
            true
        );
        chart.on('click', (params) => {
            if (params.componentType !== 'yAxis') {
                return;
            }

            const row = chartRows[params.dataIndex];
            const target = detailGroupRefs.current.get(
                getActivityDetailKey(row?.location, row?.joinMs)
            );
            target?.scrollIntoView?.({
                behavior: 'smooth',
                block: 'start'
            });
        });
    }, [
        barWidth,
        chartRows,
        hour12,
        mainChartElement,
        resolvedTheme,
        selectedDate,
        t
    ]);

    function handleDateStep(isNext = false) {
        if (!sortedDatesDesc.length) {
            return;
        }

        if (selectedDateIndex === -1 && !isNext) {
            const earlierDate = sortedDatesDesc.find(
                (value) => value < selectedDate
            );
            if (earlierDate) {
                setSelectedDate(earlierDate);
                return;
            }
        }

        if (selectedDateIndex !== -1) {
            const nextIndex = isNext
                ? selectedDateIndex - 1
                : selectedDateIndex + 1;
            if (nextIndex >= 0 && nextIndex < sortedDatesDesc.length) {
                setSelectedDate(sortedDatesDesc[nextIndex]);
                return;
            }
        }

        setSelectedDate(isNext ? latestDate : earliestDate);
    }

    function handleRefresh() {
        setReloadToken((value) => value + 1);
    }

    function handleBarWidthCommit(value) {
        const nextValue = Math.min(
            50,
            Math.max(1, Number.parseInt(value, 10) || DEFAULT_BAR_WIDTH)
        );
        setBarWidth(nextValue);
        void configRepository.setInt('InstanceActivityBarWidth', nextValue);
    }

    function openPreviousInstanceInfo(row) {
        if (!row?.location) {
            return;
        }
        const titleWorldName =
            row.worldName || t('dashboard.widget.unknown_world');
        setPreviousInstanceRows([row]);
        setPreviousInstanceTitle(`Previous Instance: ${titleWorldName}`);
        setPreviousInstanceOpen(true);
    }

    return (
        <div
            id="chart"
            className="x-container flex h-full min-h-0 flex-col overflow-y-auto p-6"
        >
            <div className="pt-12">
                <div className="options-container mt-0 flex items-center justify-between gap-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="shrink-0">
                            {t('view.charts.instance_activity.header')}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Refresh instance activity"
                            onClick={handleRefresh}
                        >
                            <RefreshCcwIcon data-icon="inline-start" />
                        </Button>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Instance activity settings"
                                >
                                    <Settings2Icon data-icon="inline-start" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent
                                side="bottom"
                                align="end"
                                className="flex w-72 flex-col gap-3"
                            >
                                <div className="flex h-8 items-center justify-between gap-4 text-sm">
                                    <span className="shrink-0">
                                        {t(
                                            'view.charts.instance_activity.settings.bar_width'
                                        )}
                                    </span>
                                    <Slider
                                        min={1}
                                        max={50}
                                        step={1}
                                        value={[barWidth]}
                                        onValueChange={([value]) =>
                                            handleBarWidthCommit(value)
                                        }
                                        className="w-40"
                                    />
                                </div>
                                <div className="flex h-8 items-center justify-between gap-4 text-sm">
                                    <span className="shrink-0">
                                        {t(
                                            'view.charts.instance_activity.settings.show_detail'
                                        )}
                                    </span>
                                    <Switch
                                        checked={isDetailVisible}
                                        onCheckedChange={(value) => {
                                            setIsDetailVisible(value);
                                            void configRepository.setBool(
                                                'VRCX_InstanceActivityDetailVisible',
                                                value
                                            );
                                        }}
                                    />
                                </div>
                                {isDetailVisible ? (
                                    <>
                                        <div className="flex h-8 items-center justify-between gap-4 text-sm">
                                            <span className="shrink-0">
                                                {t(
                                                    'view.charts.instance_activity.settings.show_solo_instance'
                                                )}
                                            </span>
                                            <Switch
                                                checked={isSoloInstanceVisible}
                                                onCheckedChange={(value) => {
                                                    setIsSoloInstanceVisible(
                                                        value
                                                    );
                                                    void configRepository.setBool(
                                                        'VRCX_InstanceActivitySoloInstanceVisible',
                                                        value
                                                    );
                                                }}
                                            />
                                        </div>
                                        <div className="flex h-8 items-center justify-between gap-4 text-sm">
                                            <span className="shrink-0">
                                                {t(
                                                    'view.charts.instance_activity.settings.show_no_friend_instance'
                                                )}
                                            </span>
                                            <Switch
                                                checked={
                                                    isNoFriendInstanceVisible
                                                }
                                                onCheckedChange={(value) => {
                                                    setIsNoFriendInstanceVisible(
                                                        value
                                                    );
                                                    void configRepository.setBool(
                                                        'VRCX_InstanceActivityNoFriendInstanceVisible',
                                                        value
                                                    );
                                                }}
                                            />
                                        </div>
                                    </>
                                ) : null}
                            </PopoverContent>
                        </Popover>
                        <div className="mr-2 flex items-center">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Previous day"
                                disabled={isPrevDayDisabled}
                                onClick={() => handleDateStep(false)}
                            >
                                <ChevronLeftIcon data-icon="inline-start" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Next day"
                                disabled={isNextDayDisabled}
                                onClick={() => handleDateStep(true)}
                            >
                                <ChevronRightIcon data-icon="inline-start" />
                            </Button>
                        </div>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-52 justify-start text-left font-normal"
                                    disabled={dataStatus === 'running'}
                                >
                                    <CalendarDaysIcon data-icon="inline-start" />
                                    {selectedDate}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-72 p-3">
                                <div className="grid gap-3">
                                    <Input
                                        type="date"
                                        value={selectedDate}
                                        onChange={(event) =>
                                            setSelectedDate(
                                                event.target.value ||
                                                    getTodayKey()
                                            )
                                        }
                                    />
                                    {dateOptions.length ? (
                                        <div className="grid max-h-56 gap-1 overflow-y-auto">
                                            {dateOptions.map((dayKey) => (
                                                <Button
                                                    key={dayKey}
                                                    type="button"
                                                    variant={
                                                        dayKey === selectedDate
                                                            ? 'default'
                                                            : 'ghost'
                                                    }
                                                    size="sm"
                                                    className="justify-start"
                                                    onClick={() =>
                                                        setSelectedDate(dayKey)
                                                    }
                                                >
                                                    {formatDateLabel(dayKey)}
                                                    {availableDates.includes(
                                                        dayKey
                                                    )
                                                        ? ''
                                                        : ' (no activity)'}
                                                </Button>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>

                <div className="mt-4 flex justify-center text-center">
                    <div>
                        <div className="text-muted-foreground text-sm">
                            {t('view.charts.instance_activity.online_time')}
                        </div>
                        <div className="text-2xl font-semibold">
                            {timeToText(totalOnlineTime, true)}
                        </div>
                    </div>
                </div>

                <div className="mt-4 min-w-0">
                    {dataStatus === 'running' ? (
                        <ChartLoadingState />
                    ) : dataStatus === 'error' ? (
                        <ChartEmptyState
                            title="Instance activity failed to load"
                            description={
                                dataDetail ||
                                'The chart adapter could not read game-log instance activity for the selected day.'
                            }
                        />
                    ) : (
                        <>
                            <div
                                ref={setMainChartElementRef}
                                className="w-full bg-transparent"
                            />
                            {!chartRows.length ? (
                                <ChartEmptyState
                                    title="No instance activity on this day"
                                    description={
                                        availableDates.includes(selectedDate)
                                            ? 'The selected day exists in the activity index, but the timeline query returned no current-user instance rows.'
                                            : 'This date is outside the known activity set. Use the previous/next buttons or pick a recorded day from the selector.'
                                    }
                                />
                            ) : null}
                        </>
                    )}

                    {isDetailVisible && chartRows.length ? (
                        <div>
                            <div className="px-[min(25vw,400px)] py-4">
                                <div className="flex items-center">
                                    <Separator className="flex-1" />
                                    <span className="text-muted-foreground px-2">
                                        ·
                                    </span>
                                    <Separator className="flex-1" />
                                </div>
                            </div>
                            {filteredDetailGroups.length ? (
                                filteredDetailGroups.map((group) => {
                                    const detailKeys = getDetailGroupKeys(
                                        group,
                                        currentUserId
                                    );
                                    const key = detailKeys[0];
                                    return (
                                        <div
                                            key={key}
                                            ref={(node) => {
                                                if (node) {
                                                    detailKeys.forEach(
                                                        (detailKey) => {
                                                            detailGroupRefs.current.set(
                                                                detailKey,
                                                                node
                                                            );
                                                        }
                                                    );
                                                } else {
                                                    detailKeys.forEach(
                                                        (detailKey) => {
                                                            detailGroupRefs.current.delete(
                                                                detailKey
                                                            );
                                                        }
                                                    );
                                                }
                                            }}
                                        >
                                            <InstanceActivityDetailChart
                                                group={group}
                                                barWidth={barWidth}
                                                hour12={hour12}
                                                resolvedTheme={resolvedTheme}
                                                worldDetailsById={
                                                    worldDetailsById
                                                }
                                                onOpenPreviousInstanceInfo={
                                                    openPreviousInstanceInfo
                                                }
                                            />
                                        </div>
                                    );
                                })
                            ) : (
                                <ChartEmptyState
                                    title="No detail charts match the current filters"
                                    description="Turn on solo or no-friend instances to show the hidden detail groups."
                                />
                            )}
                        </div>
                    ) : null}
                </div>
            </div>
            <PreviousInstancesTableDialog
                open={previousInstanceOpen}
                onOpenChange={setPreviousInstanceOpen}
                title={previousInstanceTitle}
                instances={previousInstanceRows}
                autoOpenInfo
            />
        </div>
    );
}
