import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CalendarDaysIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    LoaderCircleIcon,
    RefreshCcwIcon,
    Settings2Icon
} from 'lucide-react';
import * as echarts from 'echarts';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { Location } from '@/components/Location.jsx';
import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog.jsx';
import { timeToText } from '@/lib/dateTime.js';
import { cn } from '@/lib/utils.js';
import { configRepository, instanceActivityRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { getResolvedThemeMode } from '@/services/themeService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover.jsx';
import { Separator } from '@/ui/shadcn/separator.jsx';
import { Switch } from '@/ui/shadcn/switch.jsx';

const DAY_MS = 24 * 60 * 60 * 1000;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const DEFAULT_BAR_WIDTH = 25;

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

function getLocalDayBounds(dayKey) {
    const start = parseLocalDayKey(dayKey);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return {
        start,
        end,
        startMs: start.getTime(),
        endMs: end.getTime()
    };
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

function formatClock(value, hour12, includeSeconds = false) {
    try {
        return new Intl.DateTimeFormat(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: includeSeconds ? '2-digit' : undefined,
            hour12
        }).format(new Date(value));
    } catch {
        return '';
    }
}

function truncateLabel(value, maxLength = 26) {
    const text = String(value || '');
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizeInstanceRow(row, selectedDate, currentUserId, worldDetailsById) {
    const safeDuration = Math.max(0, Number(row.time) || 0);
    const leaveMs = new Date(row.created_at).getTime();
    const joinMs = Math.max(0, leaveMs - safeDuration);
    const { startMs, endMs } = getLocalDayBounds(selectedDate);
    const parsedLocation = parseLocation(row.location);
    const worldId = parsedLocation.worldId || '';
    const world = worldId ? worldDetailsById[worldId] : null;
    const worldName = world?.name || worldId || row.location || '';
    const visibleStartMs = Math.max(joinMs, startMs);
    const visibleEndMs = Math.min(leaveMs, endMs);
    const visibleDurationMs = Math.max(0, visibleEndMs - visibleStartMs);

    return {
        id: String(row.id || `${row.location}:${row.created_at}:${row.user_id}`),
        currentUserId,
        displayName: row.display_name || '',
        location: row.location,
        userId: row.user_id || '',
        parsedLocation,
        worldId,
        worldName,
        worldResolvedFromCache: Boolean(world?.name),
        joinMs,
        leaveMs,
        visibleStartMs,
        visibleDurationMs
    };
}

function getActivityDetailKey(location, joinMs) {
    return `${location || ''}:${Number.isFinite(joinMs) ? joinMs : 0}`;
}

function getDetailGroupKeys(group, currentUserId) {
    const currentUserEntries = group.filter((entry) => entry.userId === currentUserId);
    const entries = currentUserEntries.length ? currentUserEntries : [group[0]];
    return entries.map((entry) => getActivityDetailKey(entry?.location, entry?.joinMs));
}

function buildChartRows(rawRows, selectedDate, currentUserId, worldDetailsById) {
    return rawRows
        .filter((row) => row.user_id === currentUserId)
        .map((row) => normalizeInstanceRow(row, selectedDate, currentUserId, worldDetailsById))
        .sort((left, right) => left.joinMs - right.joinMs);
}

function buildChartOption({ rows, selectedDate, barWidth, hour12, t }) {
    const { startMs } = getLocalDayBounds(selectedDate);

    return {
        animationDuration: 250,
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'shadow'
            },
            formatter(params) {
                const target = Array.isArray(params)
                    ? params.find((item) => item.seriesName === 'Time') || params[0]
                    : params;
                const row = rows[target?.dataIndex];
                if (!row) {
                    return '';
                }

                const locationBits = [];
                if (row.parsedLocation.instanceName) {
                    locationBits.push(`#${row.parsedLocation.instanceName}`);
                }
                if (row.parsedLocation.accessTypeName) {
                    locationBits.push(row.parsedLocation.accessTypeName);
                }

                return [
                    `<div class="min-w-[180px]">`,
                    `<div style="font-weight:600;margin-bottom:4px;">${row.worldName}</div>`,
                    locationBits.length
                        ? `<div style="margin-bottom:4px;">${locationBits.join(' ')}</div>`
                        : '',
                    `<div>${formatClock(row.joinMs, hour12, true)} - ${formatClock(row.leaveMs, hour12, true)}</div>`,
                    `<div>${t('view.charts.instance_activity.online_time')}: ${timeToText(row.visibleDurationMs, true)}</div>`,
                    `</div>`
                ].join('');
            }
        },
        grid: {
            top: 24,
            left: 170,
            right: 84,
            bottom: 24
        },
        yAxis: {
            type: 'category',
            inverse: true,
            triggerEvent: true,
            axisTick: { show: false },
            axisLabel: {
                interval: 0,
                formatter(value) {
                    return truncateLabel(value);
                }
            },
            data: rows.map((row) => row.worldName)
        },
        xAxis: {
            type: 'value',
            min: 0,
            max: DAY_MS,
            interval: THREE_HOURS_MS,
            axisLabel: {
                formatter(value) {
                    return formatClock(startMs + value, hour12, false);
                }
            },
            splitLine: {
                lineStyle: {
                    type: 'dashed'
                }
            }
        },
        series: [
            {
                name: 'Placeholder',
                type: 'bar',
                stack: 'Total',
                itemStyle: {
                    borderColor: 'transparent',
                    color: 'transparent'
                },
                emphasis: {
                    itemStyle: {
                        borderColor: 'transparent',
                        color: 'transparent'
                    }
                },
                data: rows.map((row) => Math.max(0, row.visibleStartMs - startMs))
            },
            {
                name: 'Time',
                type: 'bar',
                stack: 'Total',
                barWidth,
                itemStyle: {
                    borderRadius: 3,
                    shadowBlur: 2,
                    shadowOffsetX: 0.7,
                    shadowOffsetY: 0.5,
                    color(params) {
                        const row = rows[params.dataIndex];
                        if (!row) {
                            return '#60a5fa';
                        }
                        if (!row.worldResolvedFromCache) {
                            return '#94a3b8';
                        }
                        if (row.parsedLocation.accessTypeName === 'public') {
                            return '#38bdf8';
                        }
                        if (row.parsedLocation.accessTypeName === 'friends') {
                            return '#34d399';
                        }
                        if (row.parsedLocation.accessTypeName === 'group') {
                            return '#f59e0b';
                        }
                        return '#818cf8';
                    }
                },
                data: rows.map((row) => row.visibleDurationMs)
            }
        ],
        backgroundColor: 'transparent'
    };
}

function normalizeDetailRow(row, currentUserId, friendIdSet, favoriteIdSet) {
    const durationMs = Math.max(0, Number(row.time) || 0);
    const leaveMs = new Date(row.created_at).getTime();
    const joinMs = Math.max(0, leaveMs - durationMs);
    const userId = row.user_id || '';

    return {
        ...row,
        id: String(row.id || `${row.location}:${row.created_at}:${userId}`),
        displayName: row.display_name || '',
        userId,
        joinMs,
        leaveMs,
        durationMs,
        isCurrentUser: userId === currentUserId,
        isFriend: userId === currentUserId ? false : friendIdSet.has(userId) || favoriteIdSet.has(userId),
        isFavorite: userId === currentUserId ? false : favoriteIdSet.has(userId)
    };
}

function doIntervalsOverlap(left, right) {
    return !(left.leaveMs < right.joinMs || right.leaveMs < left.joinMs);
}

function splitDetailGroupsByCurrentUserOverlap(groups, currentUserId) {
    const result = [];

    for (const group of groups) {
        const currentUserCount = group.filter((entry) => entry.userId === currentUserId).length;
        if (currentUserCount <= 1) {
            result.push(group);
            continue;
        }

        const adjacency = Array.from({ length: group.length }, () => []);
        for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
                if (doIntervalsOverlap(group[leftIndex], group[rightIndex])) {
                    adjacency[leftIndex].push(rightIndex);
                    adjacency[rightIndex].push(leftIndex);
                }
            }
        }

        const visited = new Set();
        for (let index = 0; index < group.length; index += 1) {
            if (visited.has(index)) {
                continue;
            }

            const stack = [index];
            const component = [];
            visited.add(index);
            while (stack.length) {
                const current = stack.pop();
                component.push(group[current]);
                for (const next of adjacency[current]) {
                    if (!visited.has(next)) {
                        visited.add(next);
                        stack.push(next);
                    }
                }
            }
            result.push(component.sort((left, right) => left.joinMs - right.joinMs));
        }
    }

    return result.sort((left, right) => (left[0]?.joinMs || 0) - (right[0]?.joinMs || 0));
}

function buildDetailGroups(rawRows, chartRows, currentUserId, friendIdSet, favoriteIdSet) {
    const currentLocations = new Set(chartRows.map((row) => row.location).filter(Boolean));
    if (!currentUserId || !currentLocations.size) {
        return [];
    }

    const groupsByLocation = new Map();
    for (const row of rawRows) {
        if (!currentLocations.has(row.location)) {
            continue;
        }

        const entry = normalizeDetailRow(row, currentUserId, friendIdSet, favoriteIdSet);
        const existing = groupsByLocation.get(entry.location) || [];
        existing.push(entry);
        groupsByLocation.set(entry.location, existing);
    }

    const groups = Array.from(groupsByLocation.values())
        .map((group) => group.sort((left, right) => {
            const joinDiff = Math.abs(left.joinMs - right.joinMs);
            return joinDiff < 3000 ? left.leaveMs - right.leaveMs : left.joinMs - right.joinMs;
        }))
        .filter((group) => group.some((entry) => entry.userId === currentUserId));

    return splitDetailGroupsByCurrentUserOverlap(groups, currentUserId);
}

function filterDetailGroups(groups, { isDetailVisible, isSoloInstanceVisible, isNoFriendInstanceVisible }) {
    if (!isDetailVisible) {
        return [];
    }

    return groups.filter((group) => {
        if (!isSoloInstanceVisible && group.length <= 1) {
            return false;
        }

        if (!isNoFriendInstanceVisible && group.length > 1 && !group.some((entry) => entry.isFriend)) {
            return false;
        }

        return true;
    });
}

function buildDetailChartOption({ group, barWidth, hour12 }) {
    const currentUserEntry = group.find((entry) => entry.isCurrentUser);
    const startMs = currentUserEntry?.joinMs ?? Math.min(...group.map((entry) => entry.joinMs));
    const endMs = currentUserEntry?.leaveMs ?? Math.max(...group.map((entry) => entry.leaveMs));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
    }

    const groupedByUser = new Map();
    const firstEntries = [];
    for (const entry of group) {
        if (!groupedByUser.has(entry.userId)) {
            groupedByUser.set(entry.userId, []);
            firstEntries.push(entry);
        }
        groupedByUser.get(entry.userId).push(entry);
    }

    for (const entries of groupedByUser.values()) {
        entries.sort((left, right) => left.joinMs - right.joinMs);
    }

    const maxEntryCount = Math.max(...Array.from(groupedByUser.values()).map((entries) => entries.length));
    const series = [];
    for (let entryIndex = 0; entryIndex < maxEntryCount; entryIndex += 1) {
        series.push({
            name: 'Placeholder',
            type: 'bar',
            stack: 'Total',
            itemStyle: {
                borderColor: 'transparent',
                color: 'transparent'
            },
            emphasis: {
                itemStyle: {
                    borderColor: 'transparent',
                    color: 'transparent'
                }
            },
            data: firstEntries.map((entry) => {
                const rows = groupedByUser.get(entry.userId) || [];
                const row = rows[entryIndex];
                if (!row) {
                    return 0;
                }
                const previous = rows[entryIndex - 1];
                return Math.max(0, row.joinMs - (previous ? previous.leaveMs : startMs));
            })
        });
        series.push({
            name: 'Time',
            type: 'bar',
            stack: 'Total',
            barWidth,
            emphasis: {
                focus: 'self'
            },
            itemStyle: {
                borderRadius: 2,
                shadowBlur: 2,
                shadowOffsetX: 0.7,
                shadowOffsetY: 0.5
            },
            data: firstEntries.map((entry) => {
                const row = (groupedByUser.get(entry.userId) || [])[entryIndex];
                return row ? row.durationMs : 0;
            })
        });
    }

    function friendMarker(entry) {
        if (entry.isFavorite) {
            return '⭐ ';
        }
        if (entry.isFriend) {
            return '💚 ';
        }
        return '';
    }

    return {
        animationDuration: 200,
        tooltip: {
            trigger: 'item',
            formatter(params) {
                if (params.seriesIndex % 2 === 0) {
                    return '';
                }

                const userEntry = firstEntries[params.dataIndex];
                const entry = (groupedByUser.get(userEntry?.userId) || [])[Math.floor(params.seriesIndex / 2)];
                if (!entry) {
                    return '';
                }

                return [
                    `<div class="min-w-[180px]">`,
                    `<div style="font-weight:600;margin-bottom:4px;">${entry.displayName} ${friendMarker(entry).trim()}</div>`,
                    `<div>${formatClock(entry.joinMs, hour12, true)} - ${formatClock(entry.leaveMs, hour12, true)}</div>`,
                    `<div>${timeToText(entry.durationMs, true)}</div>`,
                    `</div>`
                ].join('');
            }
        },
        grid: {
            top: 24,
            left: 170,
            right: 84,
            bottom: 24
        },
        yAxis: {
            type: 'category',
            inverse: true,
            triggerEvent: true,
            axisLabel: {
                interval: 0,
                formatter(value) {
                    return truncateLabel(value, 24);
                }
            },
            data: firstEntries.map((entry) => `${friendMarker(entry)}${entry.displayName}`)
        },
        xAxis: {
            type: 'value',
            min: 0,
            max: endMs - startMs,
            axisLine: { show: true },
            axisLabel: {
                formatter(value) {
                    return formatClock(startMs + value, hour12, false);
                }
            },
            splitLine: {
                lineStyle: {
                    type: 'dashed'
                }
            }
        },
        series,
        backgroundColor: 'transparent',
        firstEntries
    };
}

function ChartLoadingState() {
    return (
        <div className="flex min-h-80 items-center justify-center rounded-xl border border-dashed bg-muted/20">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-5 animate-spin" />
                <span>Loading instance activity.</span>
            </div>
        </div>
    );
}

function ChartEmptyState({ title, description }) {
    return (
        <div className="flex min-h-80 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
            <div className="max-w-md space-y-2">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
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
    const world = parsedLocation.worldId ? worldDetailsById[parsedLocation.worldId] : null;
    const worldName = world?.name || parsedLocation.worldId || location || '';
    const currentUserEntry = group.find((entry) => entry.isCurrentUser);

    function openPreviousInstanceInfo() {
        if (!location) {
            return;
        }
        const firstEntry = currentUserEntry || group[0] || {};
        const startMs = Number.isFinite(firstEntry.joinMs)
            ? firstEntry.joinMs
            : Math.min(...group.map((entry) => entry.joinMs).filter(Number.isFinite));
        const endMs = Number.isFinite(firstEntry.leaveMs)
            ? firstEntry.leaveMs
            : Math.max(...group.map((entry) => entry.leaveMs).filter(Number.isFinite));
        onOpenPreviousInstanceInfo?.({
            location,
            worldName,
            groupName: parsedLocation.groupId || '',
            created_at: Number.isFinite(endMs) ? new Date(endMs).toISOString() : '',
            time: Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0
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

        const themeName = resolvedTheme === 'dark' || resolvedTheme === 'midnight' ? 'dark' : null;
        let chart = chartInstanceRef.current;
        if (!chart || chartThemeRef.current !== themeName) {
            resizeObserverRef.current?.disconnect();
            chart?.dispose();

            chart = echarts.init(chartElementRef.current, themeName || undefined);
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
        const chartHeight = Math.max(180, firstEntries.length * (barWidth + 10) + 110);
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
                    <div className="shrink-0 text-muted-foreground">
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
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const favoriteFriendIds = useFavoriteStore((state) => state.favoriteFriendIds);
    const localFriendFavoritesList = useFavoriteStore((state) => state.localFriendFavoritesList);
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
    const [isNoFriendInstanceVisible, setIsNoFriendInstanceVisible] = useState(true);
    const [reloadToken, setReloadToken] = useState(0);
    const [previousInstanceOpen, setPreviousInstanceOpen] = useState(false);
    const [previousInstanceRows, setPreviousInstanceRows] = useState([]);
    const [previousInstanceTitle, setPreviousInstanceTitle] = useState('Previous Instance');

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
    }, []);

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getInt('InstanceActivityBarWidth', DEFAULT_BAR_WIDTH),
            configRepository.getBool('VRCX_InstanceActivityDetailVisible', true),
            configRepository.getBool('VRCX_InstanceActivitySoloInstanceVisible', true),
            configRepository.getBool('VRCX_InstanceActivityNoFriendInstanceVisible', true)
        ])
            .then(([nextBarWidth, nextDetailVisible, nextSoloVisible, nextNoFriendVisible]) => {
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
            })
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
                    new Set(rows.map((value) => toLocalDayKey(value)).filter(Boolean))
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
            .getInstanceActivityRows(
                start.toISOString(),
                end.toISOString()
            )
            .then(async (rows) => {
                if (!active) {
                    return;
                }

                const worldIds = Array.from(
                    new Set(rows.map((row) => parseLocation(row.location).worldId).filter(Boolean))
                );
                const nextWorldDetailsById =
                    await instanceActivityRepository.getWorldSummariesByIds(worldIds);

                if (!active) {
                    return;
                }

                setRawRows(Array.isArray(rows) ? rows : []);
                setWorldDetailsById(nextWorldDetailsById);
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
    }, [currentUserId, selectedDate, reloadToken]);

    useEffect(() => {
        return () => {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
        };
    }, []);

    const chartRows = useMemo(
        () => buildChartRows(rawRows, selectedDate, currentUserId, worldDetailsById),
        [currentUserId, rawRows, selectedDate, worldDetailsById]
    );

    const friendIdSet = useMemo(() => new Set(Object.keys(friendsById)), [friendsById]);
    const favoriteIdSet = useMemo(
        () => new Set([...(favoriteFriendIds || []), ...(localFriendFavoritesList || [])]),
        [favoriteFriendIds, localFriendFavoritesList]
    );

    const detailGroups = useMemo(
        () => buildDetailGroups(rawRows, chartRows, currentUserId, friendIdSet, favoriteIdSet),
        [chartRows, currentUserId, favoriteIdSet, friendIdSet, rawRows]
    );

    const filteredDetailGroups = useMemo(
        () =>
            filterDetailGroups(detailGroups, {
                isDetailVisible,
                isSoloInstanceVisible,
                isNoFriendInstanceVisible
            }),
        [detailGroups, isDetailVisible, isNoFriendInstanceVisible, isSoloInstanceVisible]
    );

    const totalOnlineTime = useMemo(
        () => chartRows.reduce((total, row) => total + row.visibleDurationMs, 0),
        [chartRows]
    );

    const sortedDatesDesc = useMemo(
        () => [...availableDates].sort((left, right) => right.localeCompare(left)),
        [availableDates]
    );

    const earliestDate = sortedDatesDesc[sortedDatesDesc.length - 1] || null;
    const latestDate = sortedDatesDesc[0] || null;
    const selectedDateIndex = sortedDatesDesc.findIndex((value) => value === selectedDate);
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
        if (!chartElementRef.current) {
            return;
        }

        const themeName =
            resolvedTheme === 'dark' || resolvedTheme === 'midnight' ? 'dark' : null;
        let chart = chartInstanceRef.current;

        if (!chart || chartThemeRef.current !== themeName) {
            resizeObserverRef.current?.disconnect();
            chart?.dispose();

            chart = echarts.init(chartElementRef.current, themeName || undefined);
            chartInstanceRef.current = chart;
            chartThemeRef.current = themeName;

            resizeObserverRef.current = new ResizeObserver(() => {
                chart.resize();
            });
            resizeObserverRef.current.observe(chartElementRef.current);
        }

        const chartHeight = Math.max(220, chartRows.length * (barWidth + 10) + 120);
        chartElementRef.current.style.height = `${chartHeight}px`;
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
            const target = detailGroupRefs.current.get(getActivityDetailKey(row?.location, row?.joinMs));
            target?.scrollIntoView?.({
                behavior: 'smooth',
                block: 'start'
            });
        });
    }, [barWidth, chartRows, hour12, resolvedTheme, selectedDate, t]);

    function handleDateStep(isNext = false) {
        if (!sortedDatesDesc.length) {
            return;
        }

        if (selectedDateIndex === -1 && !isNext) {
            const earlierDate = sortedDatesDesc.find((value) => value < selectedDate);
            if (earlierDate) {
                setSelectedDate(earlierDate);
                return;
            }
        }

        if (selectedDateIndex !== -1) {
            const nextIndex = isNext ? selectedDateIndex - 1 : selectedDateIndex + 1;
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

    function handleBarWidthCommit(event) {
        const nextValue = Math.min(
            50,
            Math.max(1, Number.parseInt(event.target.value, 10) || DEFAULT_BAR_WIDTH)
        );
        setBarWidth(nextValue);
        void configRepository.setInt('InstanceActivityBarWidth', nextValue);
    }

    function openPreviousInstanceInfo(row) {
        if (!row?.location) {
            return;
        }
        setPreviousInstanceRows([row]);
        setPreviousInstanceTitle(`Previous Instance: ${row.worldName || row.location}`);
        setPreviousInstanceOpen(true);
    }

    return (
        <div id="chart" className="x-container flex h-full min-h-0 flex-col overflow-y-auto p-6">
            <div className="pt-12">
                <div className="options-container mt-0 flex items-center justify-between gap-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="shrink-0">{t('view.charts.instance_activity.header')}</span>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button type="button" variant="ghost" size="icon" onClick={handleRefresh}>
                            <RefreshCcwIcon className="size-4" />
                        </Button>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button type="button" variant="ghost" size="icon">
                                    <Settings2Icon className="size-4" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" align="end" className="w-72 space-y-3">
                                <div className="flex h-8 items-center justify-between gap-4 text-sm">
                                    <span className="shrink-0">{t('view.charts.instance_activity.settings.bar_width')}</span>
                                    <input
                                        type="range"
                                        min="1"
                                        max="50"
                                        step="1"
                                        value={barWidth}
                                        onChange={handleBarWidthCommit}
                                        className="w-40 accent-primary"
                                    />
                                </div>
                                <div className="flex h-8 items-center justify-between gap-4 text-sm">
                                    <span className="shrink-0">{t('view.charts.instance_activity.settings.show_detail')}</span>
                                    <Switch
                                        checked={isDetailVisible}
                                        onCheckedChange={(value) => {
                                            setIsDetailVisible(value);
                                            void configRepository.setBool('VRCX_InstanceActivityDetailVisible', value);
                                        }}
                                    />
                                </div>
                                {isDetailVisible ? (
                                    <>
                                        <div className="flex h-8 items-center justify-between gap-4 text-sm">
                                            <span className="shrink-0">{t('view.charts.instance_activity.settings.show_solo_instance')}</span>
                                            <Switch
                                                checked={isSoloInstanceVisible}
                                                onCheckedChange={(value) => {
                                                    setIsSoloInstanceVisible(value);
                                                    void configRepository.setBool('VRCX_InstanceActivitySoloInstanceVisible', value);
                                                }}
                                            />
                                        </div>
                                        <div className="flex h-8 items-center justify-between gap-4 text-sm">
                                            <span className="shrink-0">{t('view.charts.instance_activity.settings.show_no_friend_instance')}</span>
                                            <Switch
                                                checked={isNoFriendInstanceVisible}
                                                onCheckedChange={(value) => {
                                                    setIsNoFriendInstanceVisible(value);
                                                    void configRepository.setBool('VRCX_InstanceActivityNoFriendInstanceVisible', value);
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
                                disabled={isPrevDayDisabled}
                                onClick={() => handleDateStep(false)}>
                                <ChevronLeftIcon className="size-4" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                disabled={isNextDayDisabled}
                                onClick={() => handleDateStep(true)}>
                                <ChevronRightIcon className="size-4" />
                            </Button>
                        </div>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-52 justify-start text-left font-normal"
                                    disabled={dataStatus === 'running'}>
                                    <CalendarDaysIcon className="mr-2 size-4" />
                                    {selectedDate}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-72 p-3">
                                <div className="grid gap-3">
                                    <input
                                        type="date"
                                        value={selectedDate}
                                        onChange={(event) => setSelectedDate(event.target.value || getTodayKey())}
                                        className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none"
                                    />
                                    {dateOptions.length ? (
                                        <div className="grid max-h-56 gap-1 overflow-y-auto">
                                            {dateOptions.map((dayKey) => (
                                                <Button
                                                    key={dayKey}
                                                    type="button"
                                                    variant={dayKey === selectedDate ? 'default' : 'ghost'}
                                                    size="sm"
                                                    className="justify-start"
                                                    onClick={() => setSelectedDate(dayKey)}>
                                                    {formatDateLabel(dayKey)}
                                                    {availableDates.includes(dayKey) ? '' : ' (no activity)'}
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
                        <div className="text-sm text-muted-foreground">
                            {t('view.charts.instance_activity.online_time')}
                        </div>
                        <div className="text-2xl font-semibold">{timeToText(totalOnlineTime, true)}</div>
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
                        ) : !chartRows.length ? (
                            <ChartEmptyState
                                title="No instance activity on this day"
                                description={
                                    availableDates.includes(selectedDate)
                                        ? 'The selected day exists in the activity index, but the timeline query returned no current-user instance rows.'
                                        : 'This date is outside the known activity set. Use the previous/next buttons or pick a recorded day from the selector.'
                                }
                            />
                    ) : (
                        <div
                            ref={setMainChartElementRef}
                            className={cn(
                                'w-full bg-transparent',
                                resolvedTheme === 'midnight' ? 'border-primary/20' : ''
                            )}
                        />
                    )}

                    {isDetailVisible && chartRows.length ? (
                        <div>
                            <div className="px-[min(25vw,400px)] py-4">
                                <div className="flex items-center">
                                    <Separator className="flex-1" />
                                    <span className="px-2 text-muted-foreground">·</span>
                                    <Separator className="flex-1" />
                                </div>
                            </div>
                            {filteredDetailGroups.length ? (
                                filteredDetailGroups.map((group) => {
                                    const detailKeys = getDetailGroupKeys(group, currentUserId);
                                    const key = detailKeys[0];
                                    return (
                                        <div
                                            key={key}
                                            ref={(node) => {
                                                if (node) {
                                                    detailKeys.forEach((detailKey) => {
                                                        detailGroupRefs.current.set(detailKey, node);
                                                    });
                                                } else {
                                                    detailKeys.forEach((detailKey) => {
                                                        detailGroupRefs.current.delete(detailKey);
                                                    });
                                                }
                                            }}>
                                            <InstanceActivityDetailChart
                                                group={group}
                                                barWidth={barWidth}
                                                hour12={hour12}
                                                resolvedTheme={resolvedTheme}
                                                worldDetailsById={worldDetailsById}
                                                onOpenPreviousInstanceInfo={openPreviousInstanceInfo}
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
