import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { ImageIcon, RefreshCwIcon, SproutIcon, TractorIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import configRepository from '@/repositories/configRepository.js';
import worldProfileRepository from '@/repositories/worldProfileRepository.js';
import { timeToText } from '@/lib/dateTime.js';
import { cn } from '@/lib/utils.js';
import { openWorldDialog } from '@/services/dialogService.js';
import { getResolvedThemeMode } from '@/services/themeService.js';
import { userActivityViewService } from '@/services/userActivityViewService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';

const ACTIVITY_SELF_PERIOD_KEY = 'VRCX_activitySelfPeriodDays';
const ACTIVITY_FRIEND_PERIOD_KEY = 'VRCX_activityFriendPeriodDays';
const ACTIVITY_SELF_TOP_WORLDS_SORT_KEY = 'VRCX_activitySelfTopWorldsSortBy';
const ACTIVITY_SELF_EXCLUDE_HOME_WORLD_KEY = 'VRCX_activitySelfExcludeHomeWorld';
const OVERLAP_EXCLUDE_ENABLED_KEY = 'VRCX_overlapExcludeEnabled';
const OVERLAP_EXCLUDE_START_KEY = 'VRCX_overlapExcludeStart';
const OVERLAP_EXCLUDE_END_KEY = 'VRCX_overlapExcludeEnd';
const VALID_PERIODS = new Set(['7', '30', '90']);
const HOUR_LABELS = Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, '0')}:00`);
const TOP_WORLDS_LOADING_DELAY = 150;
const OVERLAP_LOADING_DELAY = 120;
const OVERLAP_RENDER_DELAY = 80;

function getRangeDays(period) {
    return Number.parseInt(period, 10) || 30;
}

function getDisplayDayLabels(dayLabels, weekStartsOn) {
    return Array.from({ length: 7 }, (_, index) => dayLabels[(weekStartsOn + index) % 7]);
}

function toHeatmapSeriesData(normalizedBuckets, weekStartsOn) {
    const data = [];
    for (let day = 0; day < 7; day += 1) {
        for (let hour = 0; hour < 24; hour += 1) {
            const slot = day * 24 + hour;
            const displayDay = (day - weekStartsOn + 7) % 7;
            data.push([hour, displayDay, normalizedBuckets?.[slot] || 0]);
        }
    }
    return data;
}

function buildHeatmapOption({
    data,
    rawBuckets,
    dayLabels,
    hourLabels,
    weekStartsOn,
    isDarkMode,
    emptyColor,
    scaleColors,
    unitLabel
}) {
    return {
        tooltip: {
            confine: true,
            position: 'top',
            formatter: (params) => {
                const [hour, dayIndex] = params.data;
                const originalDay = (dayIndex + weekStartsOn) % 7;
                const slot = originalDay * 24 + hour;
                const minutes = Math.round(rawBuckets?.[slot] || 0);
                return `${dayLabels[dayIndex]} ${hourLabels[hour]}<br/><b>${minutes}</b> ${unitLabel}`;
            }
        },
        grid: {
            top: 6,
            left: 42,
            right: 16,
            bottom: 32
        },
        xAxis: {
            type: 'category',
            data: hourLabels,
            splitArea: { show: false },
            axisLabel: {
                interval: 2,
                fontSize: 10
            },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'category',
            data: dayLabels,
            inverse: true,
            splitArea: { show: false },
            axisLabel: {
                fontSize: 11
            },
            axisTick: { show: false }
        },
        visualMap: {
            min: 0,
            max: 1,
            calculable: false,
            show: false,
            type: 'piecewise',
            dimension: 2,
            pieces: [
                { min: 0, max: 0, color: emptyColor },
                { gt: 0, lte: 0.2, color: scaleColors[0] },
                { gt: 0.2, lte: 0.4, color: scaleColors[1] },
                { gt: 0.4, lte: 0.6, color: scaleColors[2] },
                { gt: 0.6, lte: 0.8, color: scaleColors[3] },
                { gt: 0.8, lte: 1, color: scaleColors[4] }
            ]
        },
        series: [
            {
                type: 'heatmap',
                data,
                emphasis: {
                    itemStyle: {
                        borderColor: isDarkMode ? 'hsl(220, 15%, 18%)' : 'hsl(210, 18%, 78%)',
                        borderWidth: 1.5,
                        opacity: 0.92
                    }
                },
                itemStyle: {
                    borderWidth: 1.5,
                    borderColor: isDarkMode ? 'hsl(220, 15%, 8%)' : 'hsl(0, 0%, 100%)',
                    borderRadius: 2
                }
            }
        ],
        backgroundColor: 'transparent'
    };
}

function HeatmapChart({
    rawBuckets = [],
    normalizedBuckets = [],
    dayLabels,
    hourLabels,
    weekStartsOn,
    isDarkMode,
    emptyColor,
    scaleColors,
    unitLabel,
    renderDelay = 0,
    onContextMenu
}) {
    const [chartElement, setChartElement] = useState(null);
    const chartInstanceRef = useRef(null);
    const chartThemeRef = useRef(null);
    const resizeObserverRef = useRef(null);
    const renderTimerRef = useRef(null);

    useEffect(
        () => () => {
            if (renderTimerRef.current !== null) {
                clearTimeout(renderTimerRef.current);
                renderTimerRef.current = null;
            }
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
            chartThemeRef.current = null;
        },
        []
    );

    useEffect(() => {
        if (!chartElement) {
            return undefined;
        }

        if (renderTimerRef.current !== null) {
            clearTimeout(renderTimerRef.current);
            renderTimerRef.current = null;
        }

        const renderChart = () => {
            const themeName = isDarkMode ? 'dark' : null;
            let chart = chartInstanceRef.current;

            if (!chart || chartThemeRef.current !== themeName) {
                resizeObserverRef.current?.disconnect();
                chart?.dispose();
                chart = echarts.init(chartElement, themeName || undefined, { height: 240 });
                chartInstanceRef.current = chart;
                chartThemeRef.current = themeName;
                resizeObserverRef.current = new ResizeObserver(() => {
                    chart.resize();
                });
                resizeObserverRef.current.observe(chartElement);
            }

            chartElement.style.height = '240px';
            chart.resize({ height: 240 });

            if (!normalizedBuckets.length) {
                chart.clear();
                return;
            }

            chart.setOption(
                buildHeatmapOption({
                    data: toHeatmapSeriesData(normalizedBuckets, weekStartsOn),
                    rawBuckets,
                    dayLabels,
                    hourLabels,
                    weekStartsOn,
                    isDarkMode,
                    emptyColor,
                    scaleColors,
                    unitLabel
                }),
                { replaceMerge: ['series'] }
            );
        };

        if (renderDelay > 0) {
            renderTimerRef.current = setTimeout(() => {
                renderTimerRef.current = null;
                renderChart();
            }, renderDelay);
        } else {
            renderChart();
        }

        return () => {
            if (renderTimerRef.current !== null) {
                clearTimeout(renderTimerRef.current);
                renderTimerRef.current = null;
            }
        };
    }, [
        chartElement,
        dayLabels,
        emptyColor,
        hourLabels,
        isDarkMode,
        normalizedBuckets,
        rawBuckets,
        renderDelay,
        scaleColors,
        unitLabel,
        weekStartsOn
    ]);

    return (
        <div
            ref={setChartElement}
            className="min-w-0 overflow-hidden"
            style={{ width: '100%', height: 240 }}
            onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu?.();
            }}
        />
    );
}

function getWorldThumbnailUrl(world) {
    const url = world?.thumbnailImageUrl || world?.imageUrl || '';
    return url ? url.replace('256', '128') : '';
}

function TopWorldRows({ worlds, sortBy, t }) {
    const key = sortBy === 'count' ? 'visitCount' : 'totalTime';
    const maxValue = Math.max(...worlds.map((world) => world[key] || 0), 0);

    if (!worlds.length) {
        return null;
    }

    return (
        <div className="flex flex-col gap-0.5">
            {worlds.map((world, index) => {
                const value = world[key] || 0;
                const thumbnailUrl = getWorldThumbnailUrl(world);
                const barWidth = maxValue > 0 ? `${Math.max((value / maxValue) * 100, 8)}%` : '0%';
                return (
                    <Button
                        key={world.worldId || index}
                        type="button"
                        variant="ghost"
                        className={cn(
                            'h-auto w-full items-start justify-start gap-3 rounded-lg px-3 py-2 text-left font-normal transition-colors',
                            index === 0 ? 'bg-primary/5' : ''
                        )}
                        onClick={() => openWorldDialog({ worldId: world.worldId, title: world.worldName || undefined })}>
                        <span
                            className={cn(
                                'mt-1 w-5 shrink-0 text-right font-mono text-xs font-bold',
                                index === 0 ? 'text-primary' : 'text-muted-foreground'
                            )}>
                            #{index + 1}
                        </span>
                        <Avatar className="mt-0.5 size-8 shrink-0 rounded-sm">
                            {thumbnailUrl ? (
                                <AvatarImage src={thumbnailUrl} loading="lazy" decoding="async" className="rounded-sm object-cover" />
                            ) : null}
                            <AvatarFallback className="rounded-sm">
                                <ImageIcon className="size-3.5 text-muted-foreground" />
                            </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-sm font-medium">{world.worldName || 'World'}</span>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                    {sortBy === 'time'
                                        ? timeToText(world.totalTime || 0)
                                        : t('dialog.user.activity.most_visited_worlds.visit_count_label', {
                                              count: world.visitCount || 0
                                          })}
                                </span>
                            </span>
                            <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <span className="block h-full rounded-full bg-muted-foreground/45 transition-all duration-500" style={{ width: barWidth }} />
                            </span>
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}

export function UserActivityPanel({ profile, isCurrentUser, active = false }) {
    const { locale, t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const weekStartsOn = usePreferencesStore((state) => state.weekStartsOn);
    const themeMode = useShellStore((state) => state.themeMode);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedPeriod, setSelectedPeriod] = useState('30');
    const [hasAnyData, setHasAnyData] = useState(false);
    const [filteredEventCount, setFilteredEventCount] = useState(0);
    const [peakDayText, setPeakDayText] = useState('');
    const [peakTimeText, setPeakTimeText] = useState('');
    const [mainHeatmap, setMainHeatmap] = useState({ rawBuckets: [], normalizedBuckets: [] });
    const [topWorlds, setTopWorlds] = useState([]);
    const [topWorldsLoading, setTopWorldsLoading] = useState(false);
    const [topWorldsLoadingVisible, setTopWorldsLoadingVisible] = useState(false);
    const [topWorldsSortBy, setTopWorldsSortBy] = useState('time');
    const [excludeHomeWorldEnabled, setExcludeHomeWorldEnabled] = useState(false);
    const [overlapLoading, setOverlapLoading] = useState(false);
    const [overlapLoadingVisible, setOverlapLoadingVisible] = useState(false);
    const [hasOverlapData, setHasOverlapData] = useState(false);
    const [overlapPercent, setOverlapPercent] = useState(0);
    const [bestOverlapTime, setBestOverlapTime] = useState('');
    const [overlapHeatmap, setOverlapHeatmap] = useState({ rawBuckets: [], normalizedBuckets: [] });
    const [excludeHoursEnabled, setExcludeHoursEnabled] = useState(false);
    const [excludeStartHour, setExcludeStartHour] = useState('1');
    const [excludeEndHour, setExcludeEndHour] = useState('6');
    const activityRequestIdRef = useRef(0);
    const overlapRequestIdRef = useRef(0);
    const topWorldRequestIdRef = useRef(0);
    const topWorldsLoadingTimerRef = useRef(null);
    const overlapLoadingTimerRef = useRef(null);
    const easterEggTimerRef = useRef(null);
    const pendingWorldThumbnailFetchesRef = useRef(new Set());
    const lastLoadedContextRef = useRef('');
    const userId = profile?.id || '';
    const activityContextKey = `${currentUserId || ''}:${isCurrentUser ? 'self' : 'friend'}:${userId}`;
    const isDarkMode = getResolvedThemeMode(themeMode) === 'dark';
    const dayLabels = useMemo(
        () => [
            t('dialog.user.activity.days.sun'),
            t('dialog.user.activity.days.mon'),
            t('dialog.user.activity.days.tue'),
            t('dialog.user.activity.days.wed'),
            t('dialog.user.activity.days.thu'),
            t('dialog.user.activity.days.fri'),
            t('dialog.user.activity.days.sat')
        ],
        [locale, t]
    );
    const currentHomeWorldId = useMemo(() => {
        const location = currentUserSnapshot?.homeLocation || '';
        return parseLocation(location).worldId || location;
    }, [currentUserSnapshot?.homeLocation]);
    const displayDayLabels = useMemo(() => getDisplayDayLabels(dayLabels, weekStartsOn), [dayLabels, weekStartsOn]);

    function clearTopWorldsLoadingTimer() {
        if (topWorldsLoadingTimerRef.current !== null) {
            clearTimeout(topWorldsLoadingTimerRef.current);
            topWorldsLoadingTimerRef.current = null;
        }
    }

    function clearOverlapLoadingTimer() {
        if (overlapLoadingTimerRef.current !== null) {
            clearTimeout(overlapLoadingTimerRef.current);
            overlapLoadingTimerRef.current = null;
        }
    }

    function beginTopWorldsLoading(requestId) {
        setTopWorldsLoading(true);
        setTopWorldsLoadingVisible(false);
        clearTopWorldsLoadingTimer();
        topWorldsLoadingTimerRef.current = setTimeout(() => {
            topWorldsLoadingTimerRef.current = null;
            if (requestId === topWorldRequestIdRef.current) {
                setTopWorldsLoadingVisible(true);
            }
        }, TOP_WORLDS_LOADING_DELAY);
    }

    function finishTopWorldsLoading(requestId) {
        if (requestId !== topWorldRequestIdRef.current) {
            return;
        }
        clearTopWorldsLoadingTimer();
        setTopWorldsLoading(false);
        setTopWorldsLoadingVisible(false);
    }

    function beginOverlapLoading(requestId) {
        setOverlapLoading(true);
        setOverlapLoadingVisible(false);
        clearOverlapLoadingTimer();
        overlapLoadingTimerRef.current = setTimeout(() => {
            overlapLoadingTimerRef.current = null;
            if (requestId === overlapRequestIdRef.current) {
                setOverlapLoadingVisible(true);
            }
        }, OVERLAP_LOADING_DELAY);
    }

    function finishOverlapLoading(requestId) {
        if (requestId !== overlapRequestIdRef.current) {
            return;
        }
        clearOverlapLoadingTimer();
        setOverlapLoading(false);
        setOverlapLoadingVisible(false);
    }

    function resetActivityState() {
        clearTopWorldsLoadingTimer();
        clearOverlapLoadingTimer();
        topWorldRequestIdRef.current += 1;
        overlapRequestIdRef.current += 1;
        setLoading(false);
        setError('');
        setSelectedPeriod('30');
        setHasAnyData(false);
        setFilteredEventCount(0);
        setPeakDayText('');
        setPeakTimeText('');
        setMainHeatmap({ rawBuckets: [], normalizedBuckets: [] });
        setTopWorlds([]);
        setTopWorldsLoading(false);
        setTopWorldsLoadingVisible(false);
        setTopWorldsSortBy('time');
        setHasOverlapData(false);
        setOverlapPercent(0);
        setBestOverlapTime('');
        setOverlapHeatmap({ rawBuckets: [], normalizedBuckets: [] });
        setOverlapLoading(false);
        setOverlapLoadingVisible(false);
    }

    async function fetchMissingTopWorldThumbnails(worlds) {
        const pendingWorldThumbnailFetches = pendingWorldThumbnailFetchesRef.current;
        const missingWorlds = worlds.filter((world) => {
            if (!world.worldId || getWorldThumbnailUrl(world) || pendingWorldThumbnailFetches.has(world.worldId)) {
                return false;
            }
            pendingWorldThumbnailFetches.add(world.worldId);
            return true;
        });
        if (!missingWorlds.length) {
            return;
        }

        let results = [];
        try {
            results = await Promise.allSettled(
                missingWorlds.map((world) => worldProfileRepository.getWorldProfile({ worldId: world.worldId }))
            );
        } finally {
            for (const world of missingWorlds) {
                pendingWorldThumbnailFetches.delete(world.worldId);
            }
        }
        const profileByWorldId = new Map();
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value?.id) {
                profileByWorldId.set(missingWorlds[index].worldId, result.value);
            }
        });
        if (!profileByWorldId.size) {
            return;
        }

        setTopWorlds((currentRows) =>
            currentRows.map((world) => {
                const profileWorld = profileByWorldId.get(world.worldId);
                if (!profileWorld) {
                    return world;
                }
                return {
                    ...world,
                    worldName: profileWorld.name || world.worldName,
                    imageUrl: profileWorld.imageUrl || world.imageUrl || '',
                    thumbnailImageUrl: profileWorld.thumbnailImageUrl || world.thumbnailImageUrl || ''
                };
            })
        );
    }

    async function loadTopWorlds({ rangeDays, sortBy, excludeHomeWorld, requestId }) {
        if (!isCurrentUser || !userId) {
            return;
        }
        const topWorldRequestId = ++topWorldRequestIdRef.current;
        beginTopWorldsLoading(topWorldRequestId);
        try {
            const rows = await userActivityViewService.loadTopWorldsView({
                rangeDays,
                limit: 5,
                sortBy,
                excludeWorldId: excludeHomeWorld ? currentHomeWorldId : ''
            });
            if (requestId !== activityRequestIdRef.current || topWorldRequestId !== topWorldRequestIdRef.current) {
                return;
            }
            setTopWorlds(rows);
            void fetchMissingTopWorldThumbnails(rows);
        } finally {
            finishTopWorldsLoading(topWorldRequestId);
        }
    }

    function applyOverlapView(overlapView) {
        setHasOverlapData(overlapView.hasOverlapData);
        setOverlapPercent(overlapView.overlapPercent || 0);
        setBestOverlapTime(overlapView.bestOverlapTime || '');
        setOverlapHeatmap({
            rawBuckets: overlapView.rawBuckets || [],
            normalizedBuckets: overlapView.normalizedBuckets || []
        });
    }

    async function refreshTopWorldsOnly({
        sortBy = topWorldsSortBy,
        excludeHomeWorld = excludeHomeWorldEnabled,
        period = selectedPeriod
    } = {}) {
        if (!active || !isCurrentUser || !hasAnyData || !userId) {
            return;
        }
        await loadTopWorlds({
            rangeDays: getRangeDays(period),
            sortBy,
            excludeHomeWorld,
            requestId: activityRequestIdRef.current
        });
    }

    async function refreshOverlapOnly({
        excludeOverlap = excludeHoursEnabled,
        excludeStart = excludeStartHour,
        excludeEnd = excludeEndHour
    } = {}) {
        if (!active || isCurrentUser || !hasAnyData || !currentUserId || !userId) {
            return;
        }

        const requestId = ++overlapRequestIdRef.current;
        beginOverlapLoading(requestId);
        try {
            const overlapView = await userActivityViewService.loadOverlapView({
                currentUserId,
                targetUserId: userId,
                ownerUserId: currentUserId,
                rangeDays: getRangeDays(selectedPeriod),
                dayLabels,
                forceRefresh: false,
                excludeHours: {
                    enabled: excludeOverlap,
                    startHour: Number.parseInt(excludeStart, 10),
                    endHour: Number.parseInt(excludeEnd, 10)
                }
            });
            if (requestId !== overlapRequestIdRef.current) {
                return;
            }
            applyOverlapView(overlapView);
        } catch (nextError) {
            if (requestId !== overlapRequestIdRef.current) {
                return;
            }
            const message = nextError instanceof Error ? nextError.message : t('dialog.user.activity.failed_to_load', 'Failed to load activity.');
            toast.error(message);
        } finally {
            finishOverlapLoading(requestId);
        }
    }

    async function refreshData({
        forceRefresh = false,
        period = selectedPeriod,
        sortBy = topWorldsSortBy,
        excludeHomeWorld = excludeHomeWorldEnabled,
        excludeOverlap = excludeHoursEnabled,
        excludeStart = excludeStartHour,
        excludeEnd = excludeEndHour
    } = {}) {
        if (!active || !userId) {
            return;
        }

        const requestId = ++activityRequestIdRef.current;
        const overlapRequestId = ++overlapRequestIdRef.current;
        const rangeDays = getRangeDays(period);
        setLoading(true);
        setError('');
        try {
            const activityView = await userActivityViewService.loadActivityView({
                userId,
                ownerUserId: currentUserId,
                isSelf: isCurrentUser,
                rangeDays,
                dayLabels,
                forceRefresh
            });
            if (requestId !== activityRequestIdRef.current) {
                return;
            }

            setHasAnyData(activityView.hasAnyData);
            setFilteredEventCount(activityView.filteredEventCount || 0);
            setPeakDayText(activityView.peakDay || '');
            setPeakTimeText(activityView.peakTime || '');
            setMainHeatmap({
                rawBuckets: activityView.rawBuckets || [],
                normalizedBuckets: activityView.normalizedBuckets || []
            });
            lastLoadedContextRef.current = activityContextKey;

            if (!activityView.hasAnyData) {
                setTopWorlds([]);
                setTopWorldsLoading(false);
                setTopWorldsLoadingVisible(false);
                setHasOverlapData(false);
                setOverlapHeatmap({ rawBuckets: [], normalizedBuckets: [] });
                return;
            }

            if (isCurrentUser) {
                await loadTopWorlds({ rangeDays, sortBy, excludeHomeWorld, requestId });
                if (requestId !== activityRequestIdRef.current) {
                    return;
                }
                setHasOverlapData(false);
                return;
            }

            if (!currentUserId) {
                setHasOverlapData(false);
                return;
            }

            beginOverlapLoading(overlapRequestId);
            const overlapView = await userActivityViewService.loadOverlapView({
                currentUserId,
                targetUserId: userId,
                ownerUserId: currentUserId,
                rangeDays,
                dayLabels,
                forceRefresh,
                excludeHours: {
                    enabled: excludeOverlap,
                    startHour: Number.parseInt(excludeStart, 10),
                    endHour: Number.parseInt(excludeEnd, 10)
                }
            });
            if (requestId !== activityRequestIdRef.current) {
                return;
            }
            applyOverlapView(overlapView);
        } catch (nextError) {
            if (requestId !== activityRequestIdRef.current) {
                return;
            }
            const message = nextError instanceof Error ? nextError.message : t('dialog.user.activity.failed_to_load', 'Failed to load activity.');
            setError(message);
            toast.error(message);
        } finally {
            if (requestId === activityRequestIdRef.current) {
                setLoading(false);
            }
            finishOverlapLoading(overlapRequestId);
        }
    }

    useEffect(() => {
        if (!active) {
            activityRequestIdRef.current += 1;
            overlapRequestIdRef.current += 1;
            topWorldRequestIdRef.current += 1;
            clearTopWorldsLoadingTimer();
            clearOverlapLoadingTimer();
            setLoading(false);
            setOverlapLoading(false);
            setOverlapLoadingVisible(false);
            setTopWorldsLoading(false);
            setTopWorldsLoadingVisible(false);
            return undefined;
        }

        let isMounted = true;
        const baseRequestId = ++activityRequestIdRef.current;
        const contextChanged = lastLoadedContextRef.current !== activityContextKey;
        if (contextChanged) {
            resetActivityState();
        } else if (hasAnyData || loading) {
            setError('');
            return () => {
                isMounted = false;
            };
        } else {
            setError('');
        }

        async function loadSettingsAndData() {
            const [
                period,
                sortBy,
                excludeHomeWorld,
                overlapExcludeEnabled,
                overlapExcludeStart,
                overlapExcludeEnd
            ] = await Promise.all([
                configRepository.getString(isCurrentUser ? ACTIVITY_SELF_PERIOD_KEY : ACTIVITY_FRIEND_PERIOD_KEY, '30'),
                configRepository.getString(ACTIVITY_SELF_TOP_WORLDS_SORT_KEY, 'time'),
                configRepository.getBool(ACTIVITY_SELF_EXCLUDE_HOME_WORLD_KEY, false),
                configRepository.getBool(OVERLAP_EXCLUDE_ENABLED_KEY, false),
                configRepository.getString(OVERLAP_EXCLUDE_START_KEY, '1'),
                configRepository.getString(OVERLAP_EXCLUDE_END_KEY, '6')
            ]);
            if (!isMounted || baseRequestId !== activityRequestIdRef.current) {
                return;
            }

            const nextPeriod = VALID_PERIODS.has(period) ? period : '30';
            const nextSortBy = ['time', 'count'].includes(sortBy) ? sortBy : 'time';
            const nextExcludeStart = String(overlapExcludeStart);
            const nextExcludeEnd = String(overlapExcludeEnd);
            const nextExcludeHomeWorld = Boolean(excludeHomeWorld);
            const nextExcludeOverlap = Boolean(overlapExcludeEnabled);
            setSelectedPeriod(nextPeriod);
            setTopWorldsSortBy(nextSortBy);
            setExcludeHomeWorldEnabled(nextExcludeHomeWorld);
            setExcludeHoursEnabled(nextExcludeOverlap);
            setExcludeStartHour(nextExcludeStart);
            setExcludeEndHour(nextExcludeEnd);
            activityRequestIdRef.current = baseRequestId - 1;
            await refreshData({
                period: nextPeriod,
                sortBy: nextSortBy,
                excludeHomeWorld: nextExcludeHomeWorld,
                excludeOverlap: nextExcludeOverlap,
                excludeStart: nextExcludeStart,
                excludeEnd: nextExcludeEnd
            });
        }

        void loadSettingsAndData();
        return () => {
            isMounted = false;
        };
    }, [active, activityContextKey]);

    useEffect(
        () => () => {
            clearTopWorldsLoadingTimer();
            clearOverlapLoadingTimer();
            if (easterEggTimerRef.current !== null) {
                clearTimeout(easterEggTimerRef.current);
                easterEggTimerRef.current = null;
            }
        },
        []
    );

    useEffect(() => {
        if (active && isCurrentUser && excludeHomeWorldEnabled && hasAnyData) {
            void refreshTopWorldsOnly();
        }
    }, [currentHomeWorldId]);

    async function changePeriod(value) {
        const nextPeriod = VALID_PERIODS.has(value) ? value : '30';
        setSelectedPeriod(nextPeriod);
        await configRepository.setString(isCurrentUser ? ACTIVITY_SELF_PERIOD_KEY : ACTIVITY_FRIEND_PERIOD_KEY, nextPeriod);
        await refreshData({ period: nextPeriod });
    }

    async function changeTopWorldsSort(value) {
        const nextSortBy = ['time', 'count'].includes(value) ? value : 'time';
        setTopWorldsSortBy(nextSortBy);
        await configRepository.setString(ACTIVITY_SELF_TOP_WORLDS_SORT_KEY, nextSortBy);
        await refreshTopWorldsOnly({ sortBy: nextSortBy });
    }

    async function changeExcludeHomeWorld(value) {
        setExcludeHomeWorldEnabled(value);
        await configRepository.setBool(ACTIVITY_SELF_EXCLUDE_HOME_WORLD_KEY, value);
        await refreshTopWorldsOnly({ excludeHomeWorld: value });
    }

    async function changeExcludeHours(value) {
        setExcludeHoursEnabled(value);
        await configRepository.setBool(OVERLAP_EXCLUDE_ENABLED_KEY, value);
        await refreshOverlapOnly({ excludeOverlap: value });
    }

    async function changeExcludeRange(kind, value) {
        const nextStart = kind === 'start' ? value : excludeStartHour;
        const nextEnd = kind === 'end' ? value : excludeEndHour;
        if (kind === 'start') {
            setExcludeStartHour(value);
        } else {
            setExcludeEndHour(value);
        }
        await Promise.all([
            configRepository.setString(OVERLAP_EXCLUDE_START_KEY, nextStart),
            configRepository.setString(OVERLAP_EXCLUDE_END_KEY, nextEnd)
        ]);
        await refreshOverlapOnly({ excludeStart: nextStart, excludeEnd: nextEnd });
    }

    function onActivityChartRightClick() {
        toast(t('dialog.user.activity.chart_hint'), {
            position: 'bottom-center',
            icon: <TractorIcon className="size-4" />
        });
        if (easterEggTimerRef.current !== null) {
            clearTimeout(easterEggTimerRef.current);
        }
        easterEggTimerRef.current = setTimeout(() => {
            easterEggTimerRef.current = null;
        }, 5000);
    }

    function onOverlapChartRightClick() {
        if (!easterEggTimerRef.current) {
            return;
        }
        toast(t('dialog.user.activity.chart_hint_reply'), {
            position: 'bottom-center',
            icon: <SproutIcon className="size-4" />
        });
    }

    const activityScaleColors = useMemo(
        () => isDarkMode
            ? ['hsl(160, 40%, 24%)', 'hsl(150, 48%, 32%)', 'hsl(142, 55%, 38%)', 'hsl(142, 65%, 46%)', 'hsl(142, 80%, 55%)']
            : ['hsl(160, 40%, 82%)', 'hsl(155, 45%, 68%)', 'hsl(142, 55%, 55%)', 'hsl(142, 65%, 40%)', 'hsl(142, 76%, 30%)'],
        [isDarkMode]
    );
    const overlapScaleColors = useMemo(
        () => isDarkMode
            ? ['hsl(260, 30%, 26%)', 'hsl(260, 42%, 36%)', 'hsl(260, 50%, 45%)', 'hsl(260, 60%, 54%)', 'hsl(260, 70%, 62%)']
            : ['hsl(260, 35%, 85%)', 'hsl(260, 42%, 70%)', 'hsl(260, 48%, 58%)', 'hsl(260, 55%, 48%)', 'hsl(260, 60%, 38%)'],
        [isDarkMode]
    );
    const emptyColor = isDarkMode ? 'hsl(220, 15%, 12%)' : 'hsl(210, 30%, 95%)';

    return (
        <div className="flex min-w-0 flex-col overflow-x-hidden" style={{ minHeight: 200 }}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-full"
                        disabled={loading}
                        aria-label={t('dialog.user.activity.refresh_hint')}
                        title={t('dialog.user.activity.refresh_hint')}
                        onClick={() => void refreshData({ forceRefresh: true })}>
                        {loading ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
                    </Button>
                    {filteredEventCount > 0 ? (
                        <span className="ml-1 text-sm text-accent-foreground">
                            {t('dialog.user.activity.total_events', { count: filteredEventCount })}
                        </span>
                    ) : null}
                </div>
                {hasAnyData ? (
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{t('dialog.user.activity.period')}</span>
                        <Select value={selectedPeriod} onValueChange={(value) => void changePeriod(value)} disabled={loading}>
                            <SelectTrigger size="sm" className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="90">{t('dialog.user.activity.period_90')}</SelectItem>
                                    <SelectItem value="30">{t('dialog.user.activity.period_30')}</SelectItem>
                                    <SelectItem value="7">{t('dialog.user.activity.period_7')}</SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}
            </div>

            {peakDayText || peakTimeText ? (
                <div className="mb-1 mt-2 flex gap-4 text-sm">
                    {peakDayText ? (
                        <div>
                            <span className="text-muted-foreground">{t('dialog.user.activity.most_active_day')}</span>
                            <span className="ml-1 font-medium">{peakDayText}</span>
                        </div>
                    ) : null}
                    {peakTimeText ? (
                        <div>
                            <span className="text-muted-foreground">{t('dialog.user.activity.most_active_time')}</span>
                            <span className="ml-1 font-medium">{peakTimeText}</span>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {loading && !hasAnyData ? (
                <div className="mt-8 flex flex-1 flex-col items-center justify-center gap-2">
                    <Spinner className="size-5" />
                    <span className="text-sm text-muted-foreground">{t('dialog.user.activity.preparing_data')}</span>
                    <span className="text-xs text-muted-foreground">{t('dialog.user.activity.preparing_data_hint')}</span>
                </div>
            ) : null}
            {!loading && error ? <div className="mt-8 text-center text-sm text-destructive">{error}</div> : null}
            {!loading && !error && !hasAnyData ? (
                <div className="mt-8 flex flex-1 items-center justify-center text-sm text-muted-foreground">{t('common.no_data')}</div>
            ) : null}
            {!loading && hasAnyData && filteredEventCount === 0 ? (
                <div className="mt-8 flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    {t('dialog.user.activity.no_data_in_period')}
                </div>
            ) : null}

            {filteredEventCount > 0 ? (
                <HeatmapChart
                    rawBuckets={mainHeatmap.rawBuckets}
                    normalizedBuckets={mainHeatmap.normalizedBuckets}
                    dayLabels={displayDayLabels}
                    hourLabels={HOUR_LABELS}
                    weekStartsOn={weekStartsOn}
                    isDarkMode={isDarkMode}
                    emptyColor={emptyColor}
                    scaleColors={activityScaleColors}
                    unitLabel={t('dialog.user.activity.minutes_online')}
                    onContextMenu={onActivityChartRightClick}
                />
            ) : null}

            {!isCurrentUser && hasAnyData ? (
                <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{t('dialog.user.activity.overlap.header')}</span>
                            {overlapLoadingVisible ? <Spinner className="size-3.5" /> : null}
                        </div>
                        {hasOverlapData ? (
                            <div className="flex shrink-0 items-center gap-1.5">
                                <Switch checked={excludeHoursEnabled} onCheckedChange={(value) => void changeExcludeHours(value)} className="scale-75" />
                                <span className="whitespace-nowrap text-sm text-muted-foreground">{t('dialog.user.activity.overlap.exclude_hours')}</span>
                                <Select value={excludeStartHour} onValueChange={(value) => void changeExcludeRange('start', value)}>
                                    <SelectTrigger size="sm" className="h-6 w-[78px] px-2 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {HOUR_LABELS.map((label, index) => <SelectItem key={label} value={String(index)}>{label}</SelectItem>)}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <span className="text-xs text-muted-foreground">-</span>
                                <Select value={excludeEndHour} onValueChange={(value) => void changeExcludeRange('end', value)}>
                                    <SelectTrigger size="sm" className="h-6 w-[78px] px-2 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {HOUR_LABELS.map((label, index) => <SelectItem key={label} value={String(index)}>{label}</SelectItem>)}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}
                    </div>
                    {!overlapLoadingVisible && hasOverlapData ? (
                        <div className="mb-2 flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <span className={cn('text-sm font-medium', overlapPercent > 0 ? 'text-accent-foreground' : 'text-muted-foreground')}>
                                    {overlapPercent}%
                                </span>
                                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                    <span
                                        className="block h-full rounded-full transition-all duration-500"
                                        style={{
                                            width: `${overlapPercent}%`,
                                            backgroundColor: isDarkMode ? 'hsl(260, 60%, 55%)' : 'hsl(260, 55%, 50%)'
                                        }}
                                    />
                                </span>
                            </div>
                            {bestOverlapTime ? (
                                <div className="text-sm">
                                    <span className="text-muted-foreground">{t('dialog.user.activity.overlap.peak_overlap')}</span>
                                    <span className="ml-1 font-medium">{bestOverlapTime}</span>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {hasOverlapData || overlapLoadingVisible ? (
                        <HeatmapChart
                            rawBuckets={overlapHeatmap.rawBuckets}
                            normalizedBuckets={overlapHeatmap.normalizedBuckets}
                            dayLabels={displayDayLabels}
                            hourLabels={HOUR_LABELS}
                            weekStartsOn={weekStartsOn}
                            isDarkMode={isDarkMode}
                            emptyColor={emptyColor}
                            scaleColors={overlapScaleColors}
                            unitLabel={t('dialog.user.activity.overlap.minutes_overlap')}
                            renderDelay={OVERLAP_RENDER_DELAY}
                            onContextMenu={onOverlapChartRightClick}
                        />
                    ) : !overlapLoading && !hasOverlapData ? (
                        <div className="py-2 text-sm text-muted-foreground">{t('dialog.user.activity.overlap.no_data')}</div>
                    ) : null}
                </div>
            ) : null}

            {isCurrentUser && hasAnyData ? (
                <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{t('dialog.user.activity.most_visited_worlds.header')}</span>
                            {topWorldsLoadingVisible ? <Spinner className="size-3.5" /> : null}
                        </div>
                        <div className="flex items-center gap-4">
                            {currentHomeWorldId ? (
                                <Field orientation="horizontal" className="w-auto gap-1.5 text-muted-foreground">
                                    <Switch
                                        id="activity-exclude-home-world"
                                        checked={excludeHomeWorldEnabled}
                                        onCheckedChange={(value) => void changeExcludeHomeWorld(value)}
                                        className="scale-75"
                                    />
                                    <FieldLabel htmlFor="activity-exclude-home-world" className="whitespace-nowrap text-sm font-normal text-muted-foreground">
                                        {t('dialog.user.activity.most_visited_worlds.exclude_home_world')}
                                    </FieldLabel>
                                </Field>
                            ) : null}
                            {topWorlds.length > 0 ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-muted-foreground">{t('common.sort_by')}</span>
                                    <Select value={topWorldsSortBy} onValueChange={(value) => void changeTopWorldsSort(value)} disabled={topWorldsLoading}>
                                        <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                <SelectItem value="time">{t('dialog.user.activity.most_visited_worlds.sort_by_time')}</SelectItem>
                                                <SelectItem value="count">{t('dialog.user.activity.most_visited_worlds.sort_by_count')}</SelectItem>
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </div>
                            ) : null}
                        </div>
                    </div>
                    {topWorldsLoadingVisible && !topWorlds.length ? (
                        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                            <Spinner className="size-4" />
                            <span>{t('dialog.user.activity.most_visited_worlds.loading')}</span>
                        </div>
                    ) : topWorlds.length === 0 && !loading && !topWorldsLoading ? (
                        <div className="py-2 text-sm text-muted-foreground">{t('dialog.user.activity.no_data_in_period')}</div>
                    ) : (
                        <TopWorldRows worlds={topWorlds} sortBy={topWorldsSortBy} t={t} />
                    )}
                </div>
            ) : null}
        </div>
    );
}
