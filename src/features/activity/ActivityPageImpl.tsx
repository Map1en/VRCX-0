import {
    ActivityIcon,
    CalendarRangeIcon,
    Rows2Icon,
    Rows3Icon,
    Rows4Icon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
    DateTimeRangePicker,
    type DateTimeRangeValue
} from '@/components/date-time-range-picker/DateTimeRangePicker';
import { getDisplayDayLabels } from '@/components/dialogs/user-dialog/userActivityPanelModel';
import {
    EmptyState,
    LoadingState,
    PageScaffold,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarRefreshButton,
    ToolbarSegmented,
    ToolbarTabs,
    ToolbarViews,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import { formatDateTime } from '@/lib/dateTime';
import { useTodayDate } from '@/lib/useTodayDate';
import type { ActivityCompanionOrder } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import { getResolvedThemeMode } from '@/services/themeService';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';
import { Tabs, TabsContent } from '@/ui/shadcn/tabs';

import {
    ACTIVITY_JOURNEY_DENSITY_KEY,
    ACTIVITY_PAGE_MODE_KEY,
    normalizeActivityPageMode,
    normalizeJourneyDensity,
    type ActivityPageMode,
    type JourneyDensity
} from './activityJourneyModel';
import {
    ACTIVITY_PAGE_COMPANION_ORDER_KEY,
    ACTIVITY_PAGE_SHOW_HOME_KEY,
    ACTIVITY_PAGE_RANGE_KEY,
    ACTIVITY_RANGE_OPTIONS,
    DEFAULT_ACTIVITY_RANGE,
    DEFAULT_COMPANION_ORDER,
    hasAnyActivity,
    homeWorldIdFrom,
    normalizeActivityRange,
    normalizeCompanionOrder,
    type ActivityRange
} from './activityPageModel';
import { ActivityAccessExhibit } from './components/ActivityAccessExhibit';
import { ActivityAvatarsExhibit } from './components/ActivityAvatarsExhibit';
import { ActivityJourneyView } from './components/ActivityJourneyView';
import { ActivityPeopleExhibit } from './components/ActivityPeopleExhibit';
import { ActivityRhythmExhibit } from './components/ActivityRhythmExhibit';
import { ActivityStrangersExhibit } from './components/ActivityStrangersExhibit';
import { ActivityTimeExhibit } from './components/ActivityTimeExhibit';
import { ActivityWorldsExhibit } from './components/ActivityWorldsExhibit';
import { useActivityAvatarUsage } from './useActivityAvatarUsage';
import { useActivityHeatmap } from './useActivityHeatmap';
import { useActivityJourneyFeed } from './useActivityJourney';
import { useActivityPageResource } from './useActivityPageResource';
import { useActivityPalette } from './useActivityPalette';

function Staggered({
    index,
    children
}: {
    index: number;
    children: ReactNode;
}) {
    return (
        <div
            className="activity-enter mb-3 break-inside-avoid"
            style={{ '--activity-enter-index': index } as CSSProperties}
        >
            {children}
        </div>
    );
}

export function ActivityPageImpl() {
    const { t } = useTranslation();
    const ownerUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const weekStartsOn = usePreferencesStore((state) => state.weekStartsOn);
    const themeMode = useShellStore((state) => state.themeMode);
    const isDarkMode = getResolvedThemeMode(themeMode) === 'dark';
    const [mode, setMode] = useState<ActivityPageMode | null>(null);
    const [range, setRange] = useState<ActivityRange>(DEFAULT_ACTIVITY_RANGE);
    const [companionOrder, setCompanionOrder] =
        useState<ActivityCompanionOrder>(DEFAULT_COMPANION_ORDER);
    const [showHomeWorld, setShowHomeWorld] = useState(false);
    const [journeyDensity, setJourneyDensity] =
        useState<JourneyDensity>('standard');
    const [journeyRange, setJourneyRange] = useState<DateTimeRangeValue>({
        from: null,
        to: null
    });
    const [skinElement, setSkinElement] = useState<HTMLDivElement | null>(null);
    const homeWorldId = useRuntimeStore((state) =>
        homeWorldIdFrom(state.auth.currentUserSnapshot?.homeLocation)
    );
    const screenshotsAvailable = useRuntimeStore(
        (state) => state.hostCapabilities.screenshotCache?.available === true
    );
    const palette = useActivityPalette(skinElement, isDarkMode);
    const todayDate = useTodayDate();

    useEffect(() => {
        let active = true;
        void Promise.all([
            configRepository.getString(ACTIVITY_PAGE_MODE_KEY, null),
            configRepository.getString(ACTIVITY_JOURNEY_DENSITY_KEY, null),
            configRepository.getString(ACTIVITY_PAGE_RANGE_KEY, null),
            configRepository.getString(ACTIVITY_PAGE_COMPANION_ORDER_KEY, null),
            configRepository.getBool(ACTIVITY_PAGE_SHOW_HOME_KEY, false)
        ]).then(
            ([
                storedMode,
                storedDensity,
                storedRange,
                storedOrder,
                storedShowHome
            ]) => {
                if (!active) {
                    return;
                }
                setMode(normalizeActivityPageMode(storedMode));
                setJourneyDensity(normalizeJourneyDensity(storedDensity));
                setRange(normalizeActivityRange(storedRange));
                setCompanionOrder(normalizeCompanionOrder(storedOrder));
                setShowHomeWorld(Boolean(storedShowHome));
            }
        );
        return () => {
            active = false;
        };
    }, []);

    const overviewOwnerId = mode === 'overview' ? (ownerUserId ?? '') : '';
    const journeyOwnerId = mode === 'journey' ? (ownerUserId ?? '') : '';
    const { view, loading, error, refresh } = useActivityPageResource(
        overviewOwnerId,
        range,
        companionOrder
    );
    const heatmap = useActivityHeatmap(overviewOwnerId, range);
    const avatarUsage = useActivityAvatarUsage(
        overviewOwnerId,
        range === 'all'
    );
    const journey = useActivityJourneyFeed(
        journeyOwnerId,
        journeyRange,
        mode === 'journey' && screenshotsAvailable
    );

    const modeOptions = useMemo<ToolbarSegmentOption<ActivityPageMode>[]>(
        () => [
            { value: 'overview', label: t('view.activity.mode.overview') },
            { value: 'journey', label: t('view.activity.mode.journey') }
        ],
        [t]
    );

    const densityOptions = useMemo<ToolbarSegmentOption<JourneyDensity>[]>(
        () => [
            {
                value: 'standard',
                label: t('view.friends_locations.density_options.standard'),
                icon: Rows2Icon
            },
            {
                value: 'compact',
                label: t('view.friends_locations.density_options.compact'),
                icon: Rows3Icon
            },
            {
                value: 'dense',
                label: t('view.friends_locations.density_options.dense'),
                icon: Rows4Icon
            }
        ],
        [t]
    );

    const rangeOptions = useMemo<ToolbarSegmentOption<ActivityRange>[]>(
        () =>
            ACTIVITY_RANGE_OPTIONS.map((option) => ({
                value: option,
                label:
                    option === 'all'
                        ? t('view.activity.range.all')
                        : t('view.activity.range.days', { days: option })
            })),
        [t]
    );

    const displayDayLabels = useMemo(
        () =>
            getDisplayDayLabels(
                [
                    t('dialog.user.activity.days.sun'),
                    t('dialog.user.activity.days.mon'),
                    t('dialog.user.activity.days.tue'),
                    t('dialog.user.activity.days.wed'),
                    t('dialog.user.activity.days.thu'),
                    t('dialog.user.activity.days.fri'),
                    t('dialog.user.activity.days.sat')
                ],
                weekStartsOn
            ),
        [t, weekStartsOn]
    );

    function onModeChange(next: ActivityPageMode) {
        setMode(next);
        void configRepository.setString(ACTIVITY_PAGE_MODE_KEY, next);
    }

    function onJourneyDensityChange(next: JourneyDensity) {
        setJourneyDensity(next);
        void configRepository.setString(ACTIVITY_JOURNEY_DENSITY_KEY, next);
    }

    function onRangeChange(next: ActivityRange) {
        setRange(next);
        void configRepository.setString(ACTIVITY_PAGE_RANGE_KEY, next);
    }

    function onCompanionOrderChange(next: ActivityCompanionOrder) {
        setCompanionOrder(next);
        void configRepository.setString(
            ACTIVITY_PAGE_COMPANION_ORDER_KEY,
            next
        );
    }

    function onShowHomeWorldChange(next: boolean) {
        setShowHomeWorld(next);
        void configRepository.setBool(ACTIVITY_PAGE_SHOW_HOME_KEY, next);
    }

    return (
        <PageScaffold>
            <Tabs
                value={mode ?? ''}
                onValueChange={(value) => {
                    const option = modeOptions.find(
                        (entry) => entry.value === value
                    );
                    if (option) {
                        onModeChange(option.value);
                    }
                }}
                className="flex min-h-0 flex-1 flex-col gap-0"
            >
                <PageToolbar>
                    <PageToolbarRow>
                        <ToolbarViews>
                            <ToolbarTabs options={modeOptions} />
                            {mode ? <Separator orientation="vertical" /> : null}
                            {mode === 'overview' ? (
                                <ToolbarSegmented
                                    value={range}
                                    onValueChange={onRangeChange}
                                    options={rangeOptions}
                                />
                            ) : null}
                            {mode === 'journey' ? (
                                <DateTimeRangePicker
                                    value={journeyRange}
                                    onChange={setJourneyRange}
                                    placeholder={t(
                                        'view.activity.journey.all_dates'
                                    )}
                                    startLabel={t('view.game_log.label.start')}
                                    endLabel={t('view.game_log.label.end')}
                                    clearLabel={t('common.actions.clear')}
                                    confirmLabel={t('common.actions.confirm')}
                                    formatValue={(date) =>
                                        formatDateTime(date, {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric'
                                        })
                                    }
                                    disabled={{ after: todayDate }}
                                    renderTrigger={({ active, label }) => (
                                        <Button
                                            type="button"
                                            variant={
                                                active ? 'secondary' : 'outline'
                                            }
                                        >
                                            <CalendarRangeIcon data-icon="inline-start" />
                                            {label}
                                        </Button>
                                    )}
                                />
                            ) : null}
                        </ToolbarViews>
                        <ToolbarActions className="ms-auto">
                            {mode === 'journey' ? (
                                <ToolbarSegmented
                                    value={journeyDensity}
                                    onValueChange={onJourneyDensityChange}
                                    options={densityOptions}
                                    iconOnly
                                />
                            ) : null}
                            <ToolbarRefreshButton
                                onRefresh={
                                    mode === 'journey'
                                        ? journey.refresh
                                        : refresh
                                }
                                loading={
                                    mode === 'journey'
                                        ? journey.loading
                                        : loading
                                }
                            />
                        </ToolbarActions>
                    </PageToolbarRow>
                </PageToolbar>
                <TabsContent
                    value="journey"
                    className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
                >
                    <div className="activity-skin">
                        <ActivityJourneyView
                            visits={journey.visits}
                            photos={journey.photos}
                            loading={journey.loading}
                            hasMore={journey.hasMore}
                            error={journey.error}
                            filtered={Boolean(journeyRange.from)}
                            homeWorldId={homeWorldId}
                            density={journeyDensity}
                            onLoadMore={journey.loadMore}
                        />
                    </div>
                </TabsContent>
                <TabsContent
                    value="overview"
                    className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
                >
                    <div className="activity-skin" ref={setSkinElement}>
                        {error ? (
                            <EmptyState
                                icon={ActivityIcon}
                                title={t('view.activity.error.failed_to_load')}
                                description={error}
                            />
                        ) : loading && !view ? (
                            <LoadingState />
                        ) : !hasAnyActivity(view) ? (
                            <EmptyState
                                icon={ActivityIcon}
                                title={t('view.activity.empty.title')}
                                description={t(
                                    'view.activity.empty.description'
                                )}
                            />
                        ) : view ? (
                            <div
                                key={range}
                                className="mx-auto max-w-[120rem] [columns:1] gap-3 pb-4 [column-fill:balance] min-[1600px]:[columns:3] xl:[columns:2]"
                            >
                                <Staggered index={0}>
                                    <ActivityTimeExhibit
                                        summary={view.summary}
                                        series={view.series}
                                        isDarkMode={isDarkMode}
                                    />
                                </Staggered>
                                <Staggered index={1}>
                                    <ActivityRhythmExhibit
                                        rawBuckets={heatmap.rawBuckets}
                                        normalizedBuckets={
                                            heatmap.normalizedBuckets
                                        }
                                        displayDayLabels={displayDayLabels}
                                        weekStartsOn={weekStartsOn}
                                        isDarkMode={isDarkMode}
                                        palette={palette}
                                    />
                                </Staggered>
                                <Staggered index={2}>
                                    <ActivityWorldsExhibit
                                        worlds={view.worlds}
                                        homeWorldId={homeWorldId}
                                        showHomeWorld={showHomeWorld}
                                        onShowHomeWorldChange={
                                            onShowHomeWorldChange
                                        }
                                    />
                                </Staggered>
                                <Staggered index={3}>
                                    <div className="flex flex-col gap-3">
                                        <ActivityPeopleExhibit
                                            people={view.people}
                                            order={companionOrder}
                                            pending={
                                                view.people.order !==
                                                companionOrder
                                            }
                                            onOrderChange={
                                                onCompanionOrderChange
                                            }
                                        />
                                        {view.people.strangers.length > 0 ? (
                                            <ActivityStrangersExhibit
                                                rows={view.people.strangers}
                                            />
                                        ) : null}
                                    </div>
                                </Staggered>
                                <Staggered index={4}>
                                    <ActivityAccessExhibit
                                        slices={view.accessSplit}
                                    />
                                </Staggered>
                                {range === 'all' ? (
                                    <Staggered index={5}>
                                        <ActivityAvatarsExhibit
                                            rows={avatarUsage}
                                        />
                                    </Staggered>
                                ) : null}
                                <p className="text-muted-foreground break-inside-avoid px-1 pt-1 text-xs">
                                    {t('view.activity.caveat.recorded_since', {
                                        date: view.coverage.firstSourceAt.slice(
                                            0,
                                            10
                                        )
                                    })}
                                </p>
                            </div>
                        ) : null}
                    </div>
                </TabsContent>
            </Tabs>
        </PageScaffold>
    );
}
