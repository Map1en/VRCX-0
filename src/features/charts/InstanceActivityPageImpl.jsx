import * as echarts from 'echarts';
import { RefreshCcwIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog.jsx';
import { timeToText } from '@/lib/dateTime.js';
import {
    instanceActivityRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { getResolvedThemeMode } from '@/services/themeService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';

import { InstanceActivityDateControls } from './components/InstanceActivityDateControls.jsx';
import { InstanceActivitySettingsPopover } from './components/InstanceActivitySettingsPopover.jsx';
import {
    ChartEmptyState,
    ChartLoadingState,
    InstanceActivityDetailChart
} from './components/InstanceActivityViewParts.jsx';
import { buildChartOption } from './instance-activity/instanceActivityChart.js';
import {
    getTodayKey,
    toLocalDayKey
} from './instance-activity/instanceActivityDate.js';
import {
    buildChartRows,
    buildDetailGroups,
    filterDetailGroups,
    getActivityDetailKey,
    getDetailGroupKeys,
    getLocalDayBounds
} from './instance-activity/instanceActivityRows.js';
import { useInstanceActivitySettings } from './instance-activity/useInstanceActivitySettings.js';

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

export function InstanceActivityPage() {
    const { t } = useTranslation();
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
    const [reloadToken, setReloadToken] = useState(0);
    const [previousInstanceOpen, setPreviousInstanceOpen] = useState(false);
    const [previousInstanceRows, setPreviousInstanceRows] = useState([]);
    const [previousInstanceTitle, setPreviousInstanceTitle] =
        useState('Instance Details');
    const [mainChartElement, setMainChartElement] = useState(null);

    const chartElementRef = useRef(null);
    const chartInstanceRef = useRef(null);
    const chartThemeRef = useRef(null);
    const resizeObserverRef = useRef(null);
    const detailGroupRefs = useRef(new Map());

    const {
        barWidth,
        isDetailVisible,
        isSoloInstanceVisible,
        isNoFriendInstanceVisible,
        handleBarWidthCommit,
        setDetailVisible,
        setSoloInstanceVisible,
        setNoFriendInstanceVisible
    } = useInstanceActivitySettings();

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

    function handleRefresh() {
        setReloadToken((value) => value + 1);
    }

    function openPreviousInstanceInfo(row) {
        if (!row?.location) {
            return;
        }
        setPreviousInstanceRows([row]);
        setPreviousInstanceTitle('Instance Details');
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
                            aria-label={'Refresh instance activity'}
                            onClick={handleRefresh}
                        >
                            <RefreshCcwIcon data-icon="inline-start" />
                        </Button>
                        <InstanceActivitySettingsPopover
                            barWidth={barWidth}
                            isDetailVisible={isDetailVisible}
                            isSoloInstanceVisible={isSoloInstanceVisible}
                            isNoFriendInstanceVisible={
                                isNoFriendInstanceVisible
                            }
                            onBarWidthCommit={handleBarWidthCommit}
                            onDetailVisibleChange={setDetailVisible}
                            onSoloInstanceVisibleChange={setSoloInstanceVisible}
                            onNoFriendInstanceVisibleChange={
                                setNoFriendInstanceVisible
                            }
                        />
                        <InstanceActivityDateControls
                            selectedDate={selectedDate}
                            onSelectedDateChange={setSelectedDate}
                            availableDates={availableDates}
                            dataStatus={dataStatus}
                        />
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
                            title={t(
                                'view.charts.generated.instance_activity_failed_to_load'
                            )}
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
                                    title={t(
                                        'view.charts.generated.no_instance_activity_on_this_day'
                                    )}
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
                                    title={t(
                                        'view.charts.generated.no_detail_charts_match_the_current_filters'
                                    )}
                                    description={t(
                                        'view.charts.generated.turn_on_solo_or_no_friend_instances_to_show_the_hidden_detai'
                                    )}
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
                detailsOnly
            />
        </div>
    );
}
