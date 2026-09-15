import { ActivityIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
    ToolbarTabs,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import type { ActivityCompanionOrder } from '@/repositories/activityPageRepository';
import configRepository from '@/repositories/configRepository';
import { getResolvedThemeMode } from '@/services/themeService';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { Tabs, TabsContent } from '@/ui/shadcn/tabs';

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
import { ActivityPeopleExhibit } from './components/ActivityPeopleExhibit';
import { ActivityRhythmExhibit } from './components/ActivityRhythmExhibit';
import { ActivityTimeExhibit } from './components/ActivityTimeExhibit';
import { ActivityWorldsExhibit } from './components/ActivityWorldsExhibit';
import { useActivityAvatarUsage } from './useActivityAvatarUsage';
import { useActivityHeatmap } from './useActivityHeatmap';
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
    const [range, setRange] = useState<ActivityRange>(DEFAULT_ACTIVITY_RANGE);
    const [companionOrder, setCompanionOrder] =
        useState<ActivityCompanionOrder>(DEFAULT_COMPANION_ORDER);
    const [showHomeWorld, setShowHomeWorld] = useState(false);
    const [skinElement, setSkinElement] = useState<HTMLDivElement | null>(null);
    const homeWorldId = useRuntimeStore((state) =>
        homeWorldIdFrom(state.auth.currentUserSnapshot?.homeLocation)
    );
    const palette = useActivityPalette(skinElement, isDarkMode);

    useEffect(() => {
        let active = true;
        void Promise.all([
            configRepository.getString(ACTIVITY_PAGE_RANGE_KEY, null),
            configRepository.getString(ACTIVITY_PAGE_COMPANION_ORDER_KEY, null),
            configRepository.getBool(ACTIVITY_PAGE_SHOW_HOME_KEY, false)
        ]).then(([storedRange, storedOrder, storedShowHome]) => {
            if (!active) {
                return;
            }
            setRange(normalizeActivityRange(storedRange));
            setCompanionOrder(normalizeCompanionOrder(storedOrder));
            setShowHomeWorld(Boolean(storedShowHome));
        });
        return () => {
            active = false;
        };
    }, []);

    const { view, loading, error, refresh } = useActivityPageResource(
        ownerUserId ?? '',
        range,
        companionOrder
    );
    const heatmap = useActivityHeatmap(ownerUserId ?? '', range);
    const avatarUsage = useActivityAvatarUsage(
        ownerUserId ?? '',
        range === 'all'
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
                value={range}
                onValueChange={(value) => {
                    const option = rangeOptions.find(
                        (entry) => entry.value === value
                    );
                    if (option) {
                        onRangeChange(option.value);
                    }
                }}
                className="flex min-h-0 flex-1 flex-col gap-0"
            >
                <PageToolbar>
                    <PageToolbarRow>
                        <ToolbarTabs options={rangeOptions} />
                        <ToolbarActions className="ms-auto">
                            <ToolbarRefreshButton
                                onRefresh={refresh}
                                loading={loading}
                            />
                        </ToolbarActions>
                    </PageToolbarRow>
                </PageToolbar>
                <TabsContent
                    value={range}
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
                                    <ActivityPeopleExhibit
                                        people={view.people}
                                        order={companionOrder}
                                        pending={
                                            view.people.order !== companionOrder
                                        }
                                        onOrderChange={onCompanionOrderChange}
                                    />
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
