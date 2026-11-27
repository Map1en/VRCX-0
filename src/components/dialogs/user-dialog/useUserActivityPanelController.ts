import { useEffect, useEffectEvent, useRef, useState } from 'react';

import configRepository from '@/repositories/configRepository';
import { toast } from '@/services/toastService';
import { userActivityViewService } from '@/services/userActivityViewService';

import {
    ACTIVITY_FRIEND_PERIOD_KEY,
    getRangeDays,
    normalizeActivityPeriod,
    OVERLAP_EXCLUDE_ENABLED_KEY,
    OVERLAP_EXCLUDE_END_KEY,
    OVERLAP_EXCLUDE_START_KEY,
    OVERLAP_LOADING_DELAY_MS,
    type ActivityHeatmapData
} from './userActivityPanelModel';

type UserActivityPanelControllerProps = {
    active: boolean;
    activityContextKey: string;
    currentUserId?: string | null;
    dayLabels: string[];
    failedToLoadMessage: string;
    userId?: string | null;
};

type RefreshOverlapOptions = {
    excludeEnd?: string;
    excludeOverlap?: boolean;
    excludeStart?: string;
};

type RefreshDataOptions = RefreshOverlapOptions & {
    forceRefresh?: boolean;
    period?: string;
};

type OverlapViewResult = Awaited<
    ReturnType<typeof userActivityViewService.loadOverlapView>
>;

export function useUserActivityPanelController({
    active,
    activityContextKey,
    currentUserId,
    dayLabels,
    failedToLoadMessage,
    userId
}: UserActivityPanelControllerProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedPeriod, setSelectedPeriod] = useState('30');
    const [hasAnyData, setHasAnyData] = useState(false);
    const [filteredEventCount, setFilteredEventCount] = useState(0);
    const [peakDayText, setPeakDayText] = useState('');
    const [peakTimeText, setPeakTimeText] = useState('');
    const [mainHeatmap, setMainHeatmap] = useState<ActivityHeatmapData>({
        rawBuckets: [],
        normalizedBuckets: []
    });
    const [overlapLoading, setOverlapLoading] = useState(false);
    const [overlapLoadingVisible, setOverlapLoadingVisible] = useState(false);
    const [hasOverlapData, setHasOverlapData] = useState(false);
    const [overlapPercent, setOverlapPercent] = useState(0);
    const [bestOverlapTime, setBestOverlapTime] = useState('');
    const [overlapHeatmap, setOverlapHeatmap] = useState<ActivityHeatmapData>({
        rawBuckets: [],
        normalizedBuckets: []
    });
    const [excludeHoursEnabled, setExcludeHoursEnabled] = useState(false);
    const [excludeStartHour, setExcludeStartHour] = useState('1');
    const [excludeEndHour, setExcludeEndHour] = useState('6');
    const activityRequestIdRef = useRef(0);
    const overlapRequestIdRef = useRef(0);
    const overlapLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );
    const lastLoadedContextRef = useRef('');

    function clearOverlapLoadingTimer() {
        if (overlapLoadingTimerRef.current !== null) {
            clearTimeout(overlapLoadingTimerRef.current);
            overlapLoadingTimerRef.current = null;
        }
    }

    function beginOverlapLoading(requestId: number) {
        setOverlapLoading(true);
        setOverlapLoadingVisible(false);
        clearOverlapLoadingTimer();
        overlapLoadingTimerRef.current = setTimeout(() => {
            overlapLoadingTimerRef.current = null;
            if (requestId === overlapRequestIdRef.current) {
                setOverlapLoadingVisible(true);
            }
        }, OVERLAP_LOADING_DELAY_MS);
    }

    function finishOverlapLoading(requestId: number) {
        if (requestId !== overlapRequestIdRef.current) {
            return;
        }
        clearOverlapLoadingTimer();
        setOverlapLoading(false);
        setOverlapLoadingVisible(false);
    }

    function resetActivityState() {
        clearOverlapLoadingTimer();
        overlapRequestIdRef.current += 1;
        setLoading(false);
        setError('');
        setSelectedPeriod('30');
        setHasAnyData(false);
        setFilteredEventCount(0);
        setPeakDayText('');
        setPeakTimeText('');
        setMainHeatmap({ rawBuckets: [], normalizedBuckets: [] });
        setHasOverlapData(false);
        setOverlapPercent(0);
        setBestOverlapTime('');
        setOverlapHeatmap({ rawBuckets: [], normalizedBuckets: [] });
        setOverlapLoading(false);
        setOverlapLoadingVisible(false);
    }

    function applyOverlapView(overlapView: OverlapViewResult) {
        setHasOverlapData(overlapView.hasOverlapData);
        setOverlapPercent(overlapView.overlapPercent || 0);
        setBestOverlapTime(overlapView.bestOverlapTime || '');
        setOverlapHeatmap({
            rawBuckets: overlapView.rawBuckets || [],
            normalizedBuckets: overlapView.normalizedBuckets || []
        });
    }

    async function refreshOverlapOnly({
        excludeOverlap = excludeHoursEnabled,
        excludeStart = excludeStartHour,
        excludeEnd = excludeEndHour
    }: RefreshOverlapOptions = {}) {
        if (!active || !hasAnyData || !currentUserId || !userId) {
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
            const message =
                nextError instanceof Error
                    ? nextError.message
                    : failedToLoadMessage;
            toast.add({ type: 'error', title: message });
        } finally {
            finishOverlapLoading(requestId);
        }
    }

    async function refreshData({
        forceRefresh = false,
        period = selectedPeriod,
        excludeOverlap = excludeHoursEnabled,
        excludeStart = excludeStartHour,
        excludeEnd = excludeEndHour
    }: RefreshDataOptions = {}) {
        if (!active || !userId) {
            return;
        }

        const requestId = ++activityRequestIdRef.current;
        const overlapRequestId = ++overlapRequestIdRef.current;
        const rangeDays = getRangeDays(period);
        setLoading(true);
        setError('');
        try {
            const activityView = await userActivityViewService.loadActivityView(
                {
                    userId,
                    ownerUserId: currentUserId ?? '',
                    rangeDays,
                    dayLabels,
                    forceRefresh
                }
            );
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
                setHasOverlapData(false);
                setOverlapHeatmap({ rawBuckets: [], normalizedBuckets: [] });
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
            const message =
                nextError instanceof Error
                    ? nextError.message
                    : failedToLoadMessage;
            setError(message);
            toast.add({ type: 'error', title: message });
        } finally {
            if (requestId === activityRequestIdRef.current) {
                setLoading(false);
            }
            finishOverlapLoading(overlapRequestId);
        }
    }

    const initializeActivity = useEffectEvent(() => {
        if (!active) {
            activityRequestIdRef.current += 1;
            overlapRequestIdRef.current += 1;
            clearOverlapLoadingTimer();
            setLoading(false);
            setOverlapLoading(false);
            setOverlapLoadingVisible(false);
            return undefined;
        }

        let isMounted = true;
        const baseRequestId = ++activityRequestIdRef.current;
        const contextChanged =
            lastLoadedContextRef.current !== activityContextKey;
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
                overlapExcludeEnabled,
                overlapExcludeStart,
                overlapExcludeEnd
            ] = await Promise.all([
                configRepository.getString(ACTIVITY_FRIEND_PERIOD_KEY, '30'),
                configRepository.getBool(OVERLAP_EXCLUDE_ENABLED_KEY, false),
                configRepository.getString(OVERLAP_EXCLUDE_START_KEY, '1'),
                configRepository.getString(OVERLAP_EXCLUDE_END_KEY, '6')
            ]);
            if (!isMounted || baseRequestId !== activityRequestIdRef.current) {
                return;
            }

            const nextPeriod = normalizeActivityPeriod(period);
            const nextExcludeStart = overlapExcludeStart;
            const nextExcludeEnd = overlapExcludeEnd;
            const nextExcludeOverlap = overlapExcludeEnabled;
            setSelectedPeriod(nextPeriod);
            setExcludeHoursEnabled(nextExcludeOverlap);
            setExcludeStartHour(nextExcludeStart);
            setExcludeEndHour(nextExcludeEnd);
            activityRequestIdRef.current = baseRequestId - 1;
            await refreshData({
                period: nextPeriod,
                excludeOverlap: nextExcludeOverlap,
                excludeStart: nextExcludeStart,
                excludeEnd: nextExcludeEnd
            });
        }

        loadSettingsAndData();
        return () => {
            isMounted = false;
        };
    });

    useEffect(() => initializeActivity(), [active, activityContextKey]);

    useEffect(() => () => clearOverlapLoadingTimer(), []);

    async function changePeriod(value: string) {
        const nextPeriod = normalizeActivityPeriod(value);
        setSelectedPeriod(nextPeriod);
        await configRepository.setString(
            ACTIVITY_FRIEND_PERIOD_KEY,
            nextPeriod
        );
        await refreshData({ period: nextPeriod });
    }

    async function changeExcludeHours(value: boolean) {
        setExcludeHoursEnabled(value);
        await configRepository.setBool(OVERLAP_EXCLUDE_ENABLED_KEY, value);
        await refreshOverlapOnly({ excludeOverlap: value });
    }

    async function changeExcludeRange(kind: 'start' | 'end', value: string) {
        const nextStart = kind === 'start' ? value : excludeStartHour;
        const nextEnd = kind === 'end' ? value : excludeEndHour;
        if (kind === 'start') {
            setExcludeStartHour(value);
        } else {
            setExcludeEndHour(value);
        }
        await configRepository.setMany([
            [OVERLAP_EXCLUDE_START_KEY, nextStart],
            [OVERLAP_EXCLUDE_END_KEY, nextEnd]
        ]);
        await refreshOverlapOnly({
            excludeStart: nextStart,
            excludeEnd: nextEnd
        });
    }

    return {
        bestOverlapTime,
        changeExcludeHours,
        changeExcludeRange,
        changePeriod,
        error,
        excludeEndHour,
        excludeHoursEnabled,
        excludeStartHour,
        filteredEventCount,
        hasAnyData,
        hasOverlapData,
        loading,
        mainHeatmap,
        overlapHeatmap,
        overlapLoading,
        overlapLoadingVisible,
        overlapPercent,
        peakDayText,
        peakTimeText,
        refreshData,
        selectedPeriod
    };
}
