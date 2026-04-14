import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';

import configRepository from '@/repositories/configRepository.js';
import { timeToText } from '@/lib/dateTime.js';
import { openWorldDialog } from '@/services/dialogService.js';
import { userActivityViewService } from '@/services/userActivityViewService.js';
import { buildDailySummary } from '@/shared/utils/activityEngine.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select.jsx';
import { Switch } from '@/ui/shadcn/switch.jsx';

const ACTIVITY_SELF_PERIOD_KEY = 'VRCX_activitySelfPeriodDays';
const ACTIVITY_FRIEND_PERIOD_KEY = 'VRCX_activityFriendPeriodDays';
const ACTIVITY_SELF_TOP_WORLDS_SORT_KEY = 'VRCX_activitySelfTopWorldsSortBy';
const ACTIVITY_SELF_EXCLUDE_HOME_WORLD_KEY = 'VRCX_activitySelfExcludeHomeWorld';
const VALID_PERIODS = new Set(['0', '7', '30', '90', '180', '365']);
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, '0')}:00`);

function getRangeDays(period) {
    const parsed = Number.parseInt(period, 10);
    return parsed === 0 ? userActivityViewService.FULL_CACHE_MAX_DAYS : parsed || 30;
}

function getDisplayDayLabels(weekStartsOn) {
    return Array.from({ length: 7 }, (_, index) => DAY_LABELS[(weekStartsOn + index) % 7]);
}

function HeatmapGrid({ rawBuckets = [], normalizedBuckets = [], dayLabels, weekStartsOn }) {
    return (
        <div className="mt-2 min-w-0 overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-[42px_repeat(24,minmax(18px,1fr))] gap-1 text-[10px] text-muted-foreground">
                <div />
                {HOUR_LABELS.map((hour, index) => (
                    <div key={hour} className="text-center">{index % 3 === 0 ? hour.slice(0, 2) : ''}</div>
                ))}
                {dayLabels.map((label, displayDay) => (
                    <HeatmapDayRow
                        key={label}
                        label={label}
                        displayDay={displayDay}
                        rawBuckets={rawBuckets}
                        normalizedBuckets={normalizedBuckets}
                        weekStartsOn={weekStartsOn}
                    />
                ))}
            </div>
        </div>
    );
}

function HeatmapDayRow({ label, displayDay, rawBuckets, normalizedBuckets, weekStartsOn }) {
    const originalDay = (displayDay + weekStartsOn) % 7;
    return (
        <>
            <div className="flex items-center justify-end pr-1">{label}</div>
            {HOUR_LABELS.map((hour, hourIndex) => {
                const slot = originalDay * 24 + hourIndex;
                const normalized = Math.min(Math.max(Number(normalizedBuckets[slot]) || 0, 0), 1);
                const minutes = Math.round(Number(rawBuckets[slot]) || 0);
                return (
                    <div
                        key={hour}
                        title={`${label} ${hour}: ${minutes} minutes`}
                        className="h-5 rounded-sm border border-border/70"
                        style={{
                            backgroundColor: normalized > 0
                                ? `rgba(96, 165, 250, ${0.22 + normalized * 0.68})`
                                : 'rgba(148, 163, 184, 0.12)'
                        }}
                    />
                );
            })}
        </>
    );
}

function DailyPlaytime({ sessions, rangeDays }) {
    const dailySummary = useMemo(() => {
        if (!sessions?.length) {
            return [];
        }
        const now = Date.now();
        const rangeStart = rangeDays > 0 ? now - rangeDays * 86400000 : sessions[0].start;
        return buildDailySummary(sessions, rangeStart, now);
    }, [rangeDays, sessions]);

    if (!dailySummary.length) {
        return null;
    }

    const maxValue = Math.max(...dailySummary.map((item) => item.totalMs), 0);
    const avgDailyMs = dailySummary.reduce((sum, item) => sum + item.totalMs, 0) / dailySummary.length;
    const visibleRows = dailySummary.slice(-45);

    return (
        <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Playtime Trend</span>
                <span className="text-sm text-muted-foreground">
                    Daily Avg: <strong className="text-foreground">{timeToText(avgDailyMs)}</strong>
                </span>
            </div>
            <div className="space-y-1">
                {visibleRows.map((item) => (
                    <div key={item.date} className="grid grid-cols-[6rem_1fr_4rem] items-center gap-2 text-xs">
                        <span className="truncate text-muted-foreground">{item.date}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-muted">
                            <span
                                className="block h-full rounded-full bg-muted-foreground/45"
                                style={{ width: maxValue > 0 ? `${Math.max((item.totalMs / maxValue) * 100, 4)}%` : '0%' }}
                            />
                        </span>
                        <span className="text-right tabular-nums">{timeToText(item.totalMs)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function TopWorldRows({ worlds, sortBy }) {
    const key = sortBy === 'count' ? 'visitCount' : 'totalTime';
    const maxValue = Math.max(...worlds.map((world) => world[key] || 0), 0);
    if (!worlds.length) {
        return <div className="py-2 text-sm text-muted-foreground">No activity in this period.</div>;
    }

    return (
        <div className="flex flex-col gap-0.5">
            {worlds.map((world, index) => {
                const value = world[key] || 0;
                const barWidth = maxValue > 0 ? `${Math.max((value / maxValue) * 100, 8)}%` : '0%';
                return (
                    <button
                        key={world.worldId || index}
                        type="button"
                        className="group flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted/50"
                        onClick={() => openWorldDialog({ worldId: world.worldId, title: world.worldName || undefined })}>
                        <span className="mt-1 w-5 shrink-0 text-right font-mono text-xs font-bold text-muted-foreground">#{index + 1}</span>
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted">
                            <ImageIcon className="size-3.5 text-muted-foreground" />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-sm font-medium">{world.worldName || 'World'}</span>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                    {sortBy === 'time' ? timeToText(world.totalTime || 0) : `${world.visitCount || 0} visits`}
                                </span>
                            </span>
                            <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <span className="block h-full rounded-full bg-muted-foreground/45" style={{ width: barWidth }} />
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

export function UserActivityPanel({ profile, isCurrentUser, active = false }) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const fullCacheReady = useRuntimeStore((state) => state.activity.fullCacheReady);
    const weekStartsOn = usePreferencesStore((state) => state.weekStartsOn);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedPeriod, setSelectedPeriod] = useState('30');
    const [hasAnyData, setHasAnyData] = useState(false);
    const [filteredEventCount, setFilteredEventCount] = useState(0);
    const [peakDayText, setPeakDayText] = useState('');
    const [peakTimeText, setPeakTimeText] = useState('');
    const [mainHeatmap, setMainHeatmap] = useState({ rawBuckets: [], normalizedBuckets: [] });
    const [cachedSessions, setCachedSessions] = useState([]);
    const [topWorlds, setTopWorlds] = useState([]);
    const [topWorldsLoading, setTopWorldsLoading] = useState(false);
    const [topWorldsSortBy, setTopWorldsSortBy] = useState('count');
    const [excludeHomeWorldEnabled, setExcludeHomeWorldEnabled] = useState(false);
    const [overlapLoading, setOverlapLoading] = useState(false);
    const [hasOverlapData, setHasOverlapData] = useState(false);
    const [overlapPercent, setOverlapPercent] = useState(0);
    const [bestOverlapTime, setBestOverlapTime] = useState('');
    const [overlapHeatmap, setOverlapHeatmap] = useState({ rawBuckets: [], normalizedBuckets: [] });
    const [excludeHoursEnabled, setExcludeHoursEnabled] = useState(false);
    const [excludeStartHour, setExcludeStartHour] = useState('1');
    const [excludeEndHour, setExcludeEndHour] = useState('6');
    const activityRequestIdRef = useRef(0);
    const topWorldRequestIdRef = useRef(0);
    const userId = profile?.id || '';
    const currentHomeWorldId = useMemo(() => {
        const location = currentUserSnapshot?.homeLocation || '';
        return parseLocation(location).worldId || location;
    }, [currentUserSnapshot?.homeLocation]);
    const displayDayLabels = useMemo(() => getDisplayDayLabels(weekStartsOn), [weekStartsOn]);

    async function loadTopWorlds({ rangeDays, sortBy, excludeHomeWorld, requestId }) {
        if (!isCurrentUser || !userId) {
            return;
        }
        const topWorldRequestId = ++topWorldRequestIdRef.current;
        setTopWorldsLoading(true);
        try {
            const rows = await userActivityViewService.loadTopWorldsView({
                rangeDays,
                limit: 5,
                sortBy,
                excludeWorldId: excludeHomeWorld ? currentHomeWorldId : ''
            });
            if (requestId === activityRequestIdRef.current && topWorldRequestId === topWorldRequestIdRef.current) {
                setTopWorlds(rows);
            }
        } finally {
            if (topWorldRequestId === topWorldRequestIdRef.current) {
                setTopWorldsLoading(false);
            }
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
        const rangeDays = getRangeDays(period);
        setLoading(true);
        setError('');
        try {
            const activityView = await userActivityViewService.loadActivityView({
                userId,
                ownerUserId: currentUserId,
                isSelf: isCurrentUser,
                rangeDays,
                dayLabels: DAY_LABELS,
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

            if (!activityView.hasAnyData) {
                setTopWorlds([]);
                setCachedSessions([]);
                setHasOverlapData(false);
                setOverlapHeatmap({ rawBuckets: [], normalizedBuckets: [] });
                return;
            }

            if (isCurrentUser) {
                const cache = await userActivityViewService.getCache(userId, true, currentUserId);
                if (requestId !== activityRequestIdRef.current) {
                    return;
                }
                setCachedSessions(cache.sessions || []);
                setHasOverlapData(false);
                await loadTopWorlds({ rangeDays, sortBy, excludeHomeWorld, requestId });
                return;
            }

            if (!currentUserId) {
                setHasOverlapData(false);
                return;
            }

            setOverlapLoading(true);
            const overlapView = await userActivityViewService.loadOverlapView({
                currentUserId,
                targetUserId: userId,
                ownerUserId: currentUserId,
                rangeDays,
                dayLabels: DAY_LABELS,
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
            setHasOverlapData(overlapView.hasOverlapData);
            setOverlapPercent(overlapView.overlapPercent || 0);
            setBestOverlapTime(overlapView.bestOverlapTime || '');
            setOverlapHeatmap({
                rawBuckets: overlapView.rawBuckets || [],
                normalizedBuckets: overlapView.normalizedBuckets || []
            });
        } catch (nextError) {
            if (requestId !== activityRequestIdRef.current) {
                return;
            }
            const message = nextError instanceof Error ? nextError.message : 'Failed to load activity.';
            setError(message);
            toast.error(message);
        } finally {
            if (requestId === activityRequestIdRef.current) {
                setLoading(false);
                setOverlapLoading(false);
            }
        }
    }

    useEffect(() => {
        if (!active) {
            activityRequestIdRef.current += 1;
            setLoading(false);
            setOverlapLoading(false);
            return undefined;
        }

        let isMounted = true;
        const baseRequestId = ++activityRequestIdRef.current;
        setLoading(false);
        setError('');
        setHasAnyData(false);
        setFilteredEventCount(0);
        setPeakDayText('');
        setPeakTimeText('');
        setMainHeatmap({ rawBuckets: [], normalizedBuckets: [] });
        setCachedSessions([]);
        setTopWorlds([]);
        setHasOverlapData(false);
        setOverlapHeatmap({ rawBuckets: [], normalizedBuckets: [] });

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
                configRepository.getString(ACTIVITY_SELF_TOP_WORLDS_SORT_KEY, 'count'),
                configRepository.getBool(ACTIVITY_SELF_EXCLUDE_HOME_WORLD_KEY, false),
                configRepository.getBool('overlapExcludeEnabled', false),
                configRepository.getString('overlapExcludeStart', '1'),
                configRepository.getString('overlapExcludeEnd', '6')
            ]);
            if (!isMounted || baseRequestId !== activityRequestIdRef.current) {
                return;
            }

            const nextPeriod = VALID_PERIODS.has(period) ? period : '30';
            const nextSortBy = ['time', 'count'].includes(sortBy) ? sortBy : 'count';
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
    }, [active, currentUserId, isCurrentUser, userId]);

    async function changePeriod(value) {
        const nextPeriod = VALID_PERIODS.has(value) ? value : '30';
        setSelectedPeriod(nextPeriod);
        await configRepository.setString(isCurrentUser ? ACTIVITY_SELF_PERIOD_KEY : ACTIVITY_FRIEND_PERIOD_KEY, nextPeriod);
        await refreshData({ period: nextPeriod });
    }

    async function changeTopWorldsSort(value) {
        const nextSortBy = ['time', 'count'].includes(value) ? value : 'count';
        setTopWorldsSortBy(nextSortBy);
        await configRepository.setString(ACTIVITY_SELF_TOP_WORLDS_SORT_KEY, nextSortBy);
        await refreshData({ sortBy: nextSortBy });
    }

    async function changeExcludeHomeWorld(value) {
        setExcludeHomeWorldEnabled(value);
        await configRepository.setBool(ACTIVITY_SELF_EXCLUDE_HOME_WORLD_KEY, value);
        await refreshData({ excludeHomeWorld: value });
    }

    async function changeExcludeHours(value) {
        setExcludeHoursEnabled(value);
        await configRepository.setBool('overlapExcludeEnabled', value);
        await refreshData({ excludeOverlap: value });
    }

    async function changeExcludeRange(kind, value) {
        const nextStart = kind === 'start' ? value : excludeStartHour;
        const nextEnd = kind === 'end' ? value : excludeEndHour;
        if (kind === 'start') {
            setExcludeStartHour(value);
            await configRepository.setString('overlapExcludeStart', value);
        } else {
            setExcludeEndHour(value);
            await configRepository.setString('overlapExcludeEnd', value);
        }
        await refreshData({ excludeStart: nextStart, excludeEnd: nextEnd });
    }

    const hasHeatmapData = mainHeatmap.rawBuckets.some((value) => value > 0);

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
                        title="Refresh activity"
                        onClick={() => void refreshData({ forceRefresh: true })}>
                        {loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
                    </Button>
                    {filteredEventCount > 0 ? (
                        <span className="text-sm text-muted-foreground">{filteredEventCount} events</span>
                    ) : null}
                </div>
                {hasAnyData ? (
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Period</span>
                        <Select value={selectedPeriod} onValueChange={(value) => void changePeriod(value)} disabled={loading}>
                            <SelectTrigger size="sm" className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {fullCacheReady ? <SelectItem value="0">All Time</SelectItem> : null}
                                {fullCacheReady ? <SelectItem value="365">365 Days</SelectItem> : null}
                                {fullCacheReady ? <SelectItem value="180">180 Days</SelectItem> : null}
                                <SelectItem value="90">90 Days</SelectItem>
                                <SelectItem value="30">30 Days</SelectItem>
                                <SelectItem value="7">7 Days</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}
            </div>

            {isCurrentUser && hasAnyData && !fullCacheReady ? (
                <div className="mb-1 text-xs text-muted-foreground">Activity cache is still warming up.</div>
            ) : null}
            {peakDayText || peakTimeText ? (
                <div className="mb-1 mt-2 flex gap-4 text-sm">
                    {peakDayText ? (
                        <div>
                            <span className="text-muted-foreground">Most Active Day</span>
                            <span className="ml-1 font-medium">{peakDayText}</span>
                        </div>
                    ) : null}
                    {peakTimeText ? (
                        <div>
                            <span className="text-muted-foreground">Most Active Time</span>
                            <span className="ml-1 font-medium">{peakTimeText}</span>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {loading && !hasAnyData ? (
                <div className="mt-8 flex flex-1 flex-col items-center justify-center gap-2">
                    <LoaderCircleIcon className="size-5 animate-spin" />
                    <span className="text-sm text-muted-foreground">Preparing activity data</span>
                    <span className="text-xs text-muted-foreground">This can take a moment on the first load.</span>
                </div>
            ) : null}
            {!loading && error ? <div className="mt-8 text-center text-sm text-destructive">{error}</div> : null}
            {!loading && !error && !hasAnyData ? (
                <div className="mt-8 flex flex-1 items-center justify-center text-sm text-muted-foreground">No data</div>
            ) : null}
            {!loading && hasAnyData && filteredEventCount === 0 ? (
                <div className="mt-8 flex flex-1 items-center justify-center text-sm text-muted-foreground">No data in this period.</div>
            ) : null}

            {hasHeatmapData ? (
                <HeatmapGrid
                    rawBuckets={mainHeatmap.rawBuckets}
                    normalizedBuckets={mainHeatmap.normalizedBuckets}
                    dayLabels={displayDayLabels}
                    weekStartsOn={weekStartsOn}
                />
            ) : null}

            {isCurrentUser && hasAnyData ? (
                <DailyPlaytime sessions={cachedSessions} rangeDays={getRangeDays(selectedPeriod)} />
            ) : null}

            {!isCurrentUser && hasAnyData ? (
                <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Overlap</span>
                            {overlapLoading ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
                        </div>
                        {hasOverlapData ? (
                            <div className="flex items-center gap-1.5">
                                <Switch checked={excludeHoursEnabled} onCheckedChange={(value) => void changeExcludeHours(value)} />
                                <span className="whitespace-nowrap text-sm text-muted-foreground">Exclude Hours</span>
                                <Select value={excludeStartHour} onValueChange={(value) => void changeExcludeRange('start', value)}>
                                    <SelectTrigger size="sm" className="h-6 w-[78px] px-2 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {HOUR_LABELS.map((label, index) => <SelectItem key={label} value={String(index)}>{label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <span className="text-xs text-muted-foreground">-</span>
                                <Select value={excludeEndHour} onValueChange={(value) => void changeExcludeRange('end', value)}>
                                    <SelectTrigger size="sm" className="h-6 w-[78px] px-2 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {HOUR_LABELS.map((label, index) => <SelectItem key={label} value={String(index)}>{label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}
                    </div>
                    {hasOverlapData ? (
                        <div className="mb-2 flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{overlapPercent}%</span>
                                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                    <span className="block h-full rounded-full bg-muted-foreground/45" style={{ width: `${overlapPercent}%` }} />
                                </span>
                            </div>
                            {bestOverlapTime ? (
                                <div className="text-sm">
                                    <span className="text-muted-foreground">Peak Overlap</span>
                                    <span className="ml-1 font-medium">{bestOverlapTime}</span>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {hasOverlapData || overlapLoading ? (
                        <HeatmapGrid
                            rawBuckets={overlapHeatmap.rawBuckets}
                            normalizedBuckets={overlapHeatmap.normalizedBuckets}
                            dayLabels={displayDayLabels}
                            weekStartsOn={weekStartsOn}
                        />
                    ) : (
                        <div className="py-2 text-sm text-muted-foreground">No overlap data.</div>
                    )}
                </div>
            ) : null}

            {isCurrentUser && hasAnyData ? (
                <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Most Visited Worlds</span>
                            {topWorldsLoading ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
                        </div>
                        <div className="flex items-center gap-4">
                            {currentHomeWorldId ? (
                                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <Switch checked={excludeHomeWorldEnabled} onCheckedChange={(value) => void changeExcludeHomeWorld(value)} />
                                    <span className="whitespace-nowrap">Exclude Home World</span>
                                </label>
                            ) : null}
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Sort By</span>
                                <Select value={topWorldsSortBy} onValueChange={(value) => void changeTopWorldsSort(value)} disabled={topWorldsLoading}>
                                    <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="time">Time</SelectItem>
                                        <SelectItem value="count">Count</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    {topWorldsLoading && !topWorlds.length ? (
                        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                            <LoaderCircleIcon className="size-4 animate-spin" />
                            Loading worlds...
                        </div>
                    ) : (
                        <TopWorldRows worlds={topWorlds} sortBy={topWorldsSortBy} />
                    )}
                </div>
            ) : null}
        </div>
    );
}
