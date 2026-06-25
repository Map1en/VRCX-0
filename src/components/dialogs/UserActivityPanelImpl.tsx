import { RefreshCwIcon, SproutIcon, TractorIcon } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { getResolvedThemeMode } from '@/services/themeService';
import { parseLocation } from '@/shared/utils/location';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    ActivityEmptyState,
    HeatmapChart
} from './user-dialog/components/UserActivityPanelParts';
import {
    UserActivityOverlapSection,
    UserActivityTopWorldsSection
} from './user-dialog/components/UserActivityPanelSections';
import {
    getDisplayDayLabels,
    USER_ACTIVITY_HOUR_LABELS
} from './user-dialog/userActivityPanelModel';
import { useUserActivityPanelController } from './user-dialog/useUserActivityPanelController';

export {
    getDisplayDayLabels,
    getRangeDays
} from './user-dialog/userActivityPanelModel';

export function UserActivityPanel({
    profile,
    isCurrentUser,
    active = false
}: any) {
    const { t } = useTranslation();
    const locale = useShellStore((state: any) => state.locale);
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const weekStartsOn = usePreferencesStore(
        (state: any) => state.weekStartsOn
    );
    const themeMode = useShellStore((state: any) => state.themeMode);
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
    const currentHomeLocation = currentUserSnapshot?.homeLocation || '';
    const currentHomeWorldId =
        parseLocation(currentHomeLocation).worldId || currentHomeLocation;
    const displayDayLabels = useMemo(
        () => getDisplayDayLabels(dayLabels, weekStartsOn),
        [dayLabels, weekStartsOn]
    );
    const {
        bestOverlapTime,
        changeExcludeHomeWorld,
        changeExcludeHours,
        changeExcludeRange,
        changePeriod,
        changeTopWorldsSort,
        error,
        excludeEndHour,
        excludeHomeWorldEnabled,
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
        selectedPeriod,
        topWorlds,
        topWorldsLoading,
        topWorldsLoadingVisible,
        topWorldsSortBy
    } = useUserActivityPanelController({
        active,
        activityContextKey,
        currentHomeWorldId,
        currentUserId,
        dayLabels,
        failedToLoadMessage: t(
            'dialog.user.activity.failed_to_load',
            'Failed to load activity.'
        ),
        isCurrentUser,
        userId
    });
    const easterEggTimerRef = useRef<any>(null);

    useEffect(
        () => () => {
            if (easterEggTimerRef.current !== null) {
                clearTimeout(easterEggTimerRef.current);
                easterEggTimerRef.current = null;
            }
        },
        []
    );

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
        () =>
            isDarkMode
                ? [
                      'hsl(160, 40%, 24%)',
                      'hsl(150, 48%, 32%)',
                      'hsl(142, 55%, 38%)',
                      'hsl(142, 65%, 46%)',
                      'hsl(142, 80%, 55%)'
                  ]
                : [
                      'hsl(160, 40%, 82%)',
                      'hsl(155, 45%, 68%)',
                      'hsl(142, 55%, 55%)',
                      'hsl(142, 65%, 40%)',
                      'hsl(142, 76%, 30%)'
                  ],
        [isDarkMode]
    );
    const overlapScaleColors = useMemo(
        () =>
            isDarkMode
                ? [
                      'hsl(260, 30%, 26%)',
                      'hsl(260, 42%, 36%)',
                      'hsl(260, 50%, 45%)',
                      'hsl(260, 60%, 54%)',
                      'hsl(260, 70%, 62%)'
                  ]
                : [
                      'hsl(260, 35%, 85%)',
                      'hsl(260, 42%, 70%)',
                      'hsl(260, 48%, 58%)',
                      'hsl(260, 55%, 48%)',
                      'hsl(260, 60%, 38%)'
                  ],
        [isDarkMode]
    );
    const emptyColor = isDarkMode ? 'hsl(220, 15%, 12%)' : 'hsl(210, 30%, 95%)';

    return (
        <div
            className="flex min-w-0 flex-col overflow-x-hidden"
            style={{ minHeight: 200 }}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="rounded-full"
                                disabled={loading}
                                aria-label={'Refresh activity data'}
                                onClick={() => {
                                    refreshData({ forceRefresh: true });
                                }}
                            >
                                {loading ? (
                                    <Spinner data-icon="inline-start" />
                                ) : (
                                    <RefreshCwIcon data-icon="inline-start" />
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            {t('dialog.user.activity.refresh_hint')}
                        </TooltipContent>
                    </Tooltip>
                    {filteredEventCount > 0 ? (
                        <span className="text-accent-foreground ml-1 text-sm">
                            {t('dialog.user.activity.total_events', {
                                count: filteredEventCount
                            })}
                        </span>
                    ) : null}
                </div>
                {hasAnyData ? (
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-sm">
                            {t('dialog.user.activity.period')}
                        </span>
                        <Select
                            value={selectedPeriod}
                            onValueChange={(value: any) => {
                                changePeriod(value);
                            }}
                            disabled={loading}
                        >
                            <SelectTrigger size="sm" className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="90">
                                        {t('dialog.user.activity.period_90')}
                                    </SelectItem>
                                    <SelectItem value="30">
                                        {t('dialog.user.activity.period_30')}
                                    </SelectItem>
                                    <SelectItem value="7">
                                        {t('dialog.user.activity.period_7')}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}
            </div>

            {peakDayText || peakTimeText ? (
                <div className="mt-2 mb-1 flex gap-4 text-sm">
                    {peakDayText ? (
                        <div>
                            <span className="text-muted-foreground">
                                {t('dialog.user.activity.most_active_day')}
                            </span>
                            <span className="ml-1 font-medium">
                                {peakDayText}
                            </span>
                        </div>
                    ) : null}
                    {peakTimeText ? (
                        <div>
                            <span className="text-muted-foreground">
                                {t('dialog.user.activity.most_active_time')}
                            </span>
                            <span className="ml-1 font-medium">
                                {peakTimeText}
                            </span>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {loading && !hasAnyData ? (
                <div className="mt-8 flex flex-1 flex-col items-center justify-center gap-2">
                    <Spinner className="size-5" />
                    <span className="text-muted-foreground text-sm">
                        {t('dialog.user.activity.preparing_data')}
                    </span>
                    <span className="text-muted-foreground text-xs">
                        {t('dialog.user.activity.preparing_data_hint')}
                    </span>
                </div>
            ) : null}
            {!loading && error ? (
                <Alert variant="destructive" className="mt-8">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}
            {!loading && !error && !hasAnyData ? (
                <ActivityEmptyState title={t('common.no_data')} />
            ) : null}
            {!loading && hasAnyData && filteredEventCount === 0 ? (
                <ActivityEmptyState
                    title={t('dialog.user.activity.no_data_in_period')}
                />
            ) : null}

            {filteredEventCount > 0 ? (
                <HeatmapChart
                    rawBuckets={mainHeatmap.rawBuckets}
                    normalizedBuckets={mainHeatmap.normalizedBuckets}
                    dayLabels={displayDayLabels}
                    hourLabels={USER_ACTIVITY_HOUR_LABELS}
                    weekStartsOn={weekStartsOn}
                    isDarkMode={isDarkMode}
                    emptyColor={emptyColor}
                    scaleColors={activityScaleColors}
                    unitLabel={t('dialog.user.activity.minutes_online')}
                    onContextMenu={onActivityChartRightClick}
                />
            ) : null}

            {!isCurrentUser && hasAnyData ? (
                <UserActivityOverlapSection
                    bestOverlapTime={bestOverlapTime}
                    changeExcludeHours={changeExcludeHours}
                    changeExcludeRange={changeExcludeRange}
                    dayLabels={displayDayLabels}
                    emptyColor={emptyColor}
                    excludeEndHour={excludeEndHour}
                    excludeHoursEnabled={excludeHoursEnabled}
                    excludeStartHour={excludeStartHour}
                    hasOverlapData={hasOverlapData}
                    isDarkMode={isDarkMode}
                    onOverlapChartRightClick={onOverlapChartRightClick}
                    overlapHeatmap={overlapHeatmap}
                    overlapLoading={overlapLoading}
                    overlapLoadingVisible={overlapLoadingVisible}
                    overlapPercent={overlapPercent}
                    overlapScaleColors={overlapScaleColors}
                    weekStartsOn={weekStartsOn}
                />
            ) : null}

            {isCurrentUser && hasAnyData ? (
                <UserActivityTopWorldsSection
                    changeExcludeHomeWorld={changeExcludeHomeWorld}
                    changeTopWorldsSort={changeTopWorldsSort}
                    currentHomeWorldId={currentHomeWorldId}
                    excludeHomeWorldEnabled={excludeHomeWorldEnabled}
                    loading={loading}
                    topWorlds={topWorlds}
                    topWorldsLoading={topWorldsLoading}
                    topWorldsLoadingVisible={topWorldsLoadingVisible}
                    topWorldsSortBy={topWorldsSortBy}
                />
            ) : null}
        </div>
    );
}
