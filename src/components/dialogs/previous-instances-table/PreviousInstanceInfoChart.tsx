import type { EChartsType } from 'echarts/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useKnownUserFacts } from '@/lib/useKnownUser';
import type { AvatarWearSegment } from '@/platform/tauri/bindings';
import { openUserDialog } from '@/services/dialogService';
import { getResolvedThemeMode } from '@/services/themeService';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';

import { AvatarWearLane } from './InstanceAvatarWearSummary';
import {
    INFO_CHART_PALETTES,
    buildInfoChartOption,
    buildInfoTimelineRows,
    infoChartFirstBarTop,
    infoChartHeight,
    buildInfoChartTooltipParts,
    type InfoChartRow
} from './previousInstancesChart';
import {
    normalizeInfoChartRows,
    playerUserId,
    type PreviousInstanceVisitWindow
} from './previousInstancesRows';

function InfoChartEmptyState({
    title,
    description
}: {
    title: ReactNode;
    description?: ReactNode;
}) {
    return (
        <Empty className="min-h-32 border">
            <EmptyHeader>
                <EmptyTitle>{title}</EmptyTitle>
                {description ? (
                    <EmptyDescription>{description}</EmptyDescription>
                ) : null}
            </EmptyHeader>
        </Empty>
    );
}
function createInfoChartTooltipElement(
    detailEntry: InfoChartRow,
    hour12: boolean
) {
    const parts = buildInfoChartTooltipParts(detailEntry, hour12);
    const container = document.createElement('div');
    container.className = 'min-w-44';

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '4px';
    title.textContent = parts.title;
    container.appendChild(title);

    const timeRange = document.createElement('div');
    timeRange.textContent = parts.timeRange;
    container.appendChild(timeRange);

    const duration = document.createElement('div');
    duration.textContent = parts.duration;
    container.appendChild(duration);

    return container;
}

const AVATAR_LANE_TOP_INSET = 14;
const AVATAR_LANE_HEIGHT = 32;
const AVATAR_LANE_GAP = 37;

export function PreviousInstanceInfoChart({
    rows,
    visitWindow,
    avatarSegments
}: {
    rows: NonNullable<Parameters<typeof normalizeInfoChartRows>[0]>;
    visitWindow: PreviousInstanceVisitWindow | null;
    avatarSegments: readonly AvatarWearSegment[];
}) {
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

    const [chartElement, setChartElement] = useState<HTMLDivElement | null>(
        null
    );
    const chartElementRef = useRef<HTMLDivElement | null>(null);
    const chartInstanceRef = useRef<EChartsType | null>(null);
    const chartThemeRef = useRef<string | null>(null);
    const echartsRef = useRef<typeof import('@/lib/echarts') | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    const favoriteIdSet = useMemo(
        () =>
            new Set(
                [
                    ...(favoriteFriendIds || []),
                    ...(localFriendFavoritesList || [])
                ].filter(Boolean)
            ),
        [favoriteFriendIds, localFriendFavoritesList]
    );
    const chartUserIds = useMemo(() => {
        const seen = new Set();
        const ids = [];
        for (const row of Array.isArray(rows) ? rows : []) {
            const userId = playerUserId(row);
            if (!userId || seen.has(userId)) {
                continue;
            }
            seen.add(userId);
            ids.push(userId);
        }
        return ids;
    }, [rows]);
    const knownUsersById = useKnownUserFacts(chartUserIds, {
        endpoint: currentEndpoint
    });
    const chartRows = useMemo(
        () =>
            normalizeInfoChartRows(
                rows,
                currentUserId || '',
                friendsById,
                favoriteIdSet,
                knownUsersById
            ),
        [currentUserId, favoriteIdSet, friendsById, knownUsersById, rows]
    );
    const timelineRows = useMemo(
        () => buildInfoTimelineRows({ rows: chartRows, visitWindow }),
        [chartRows, visitWindow]
    );
    const topInset = avatarSegments.length ? AVATAR_LANE_TOP_INSET : 0;
    const chartPayload = useMemo(
        () =>
            buildInfoChartOption({
                topInset,
                rows: timelineRows,
                hour12,
                palette:
                    INFO_CHART_PALETTES[
                        resolvedTheme === 'dark' ? 'dark' : 'light'
                    ],
                tooltipFormatter: createInfoChartTooltipElement
            }),
        [hour12, resolvedTheme, timelineRows, topInset]
    );

    const setInfoChartElementRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (chartElementRef.current && chartElementRef.current !== node) {
                resizeObserverRef.current?.disconnect();
                chartInstanceRef.current?.dispose();
                resizeObserverRef.current = null;
                chartInstanceRef.current = null;
                chartThemeRef.current = null;
            }
            chartElementRef.current = node;
            setChartElement(node);
        },
        []
    );

    useEffect(
        () => () => {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
            chartThemeRef.current = null;
        },
        []
    );

    useEffect(() => {
        const element = chartElementRef.current;
        if (!chartElement || element !== chartElement) {
            return;
        }

        let cancelled = false;

        async function renderChart() {
            const echartsModule =
                echartsRef.current || (await import('@/lib/echarts'));
            if (cancelled || !element || chartElementRef.current !== element) {
                return;
            }
            echartsRef.current = echartsModule;
            const { echarts } = echartsModule;

            const themeName = resolvedTheme === 'dark' ? 'dark' : null;
            let chart = chartInstanceRef.current;

            if (!chart || chartThemeRef.current !== themeName) {
                resizeObserverRef.current?.disconnect();
                chart?.dispose();

                const nextChart = echarts.init(
                    element,
                    themeName || undefined,
                    {
                        useDirtyRect: timelineRows.length > 80
                    }
                );
                chart = nextChart;
                chartInstanceRef.current = nextChart;
                chartThemeRef.current = themeName;

                resizeObserverRef.current = new ResizeObserver(() => {
                    nextChart.resize();
                });
                resizeObserverRef.current.observe(element);
            }

            if (!chart) {
                return;
            }

            const chartRowCount =
                chartPayload?.firstEntries.length || timelineRows.length;
            const chartHeight = infoChartHeight(chartRowCount, topInset);
            element.style.height = `${chartHeight}px`;
            chart.resize({ height: chartHeight });
            chart.off('click');

            if (!chartPayload) {
                chart.clear();
                return;
            }

            chart.clear();
            chart.setOption(chartPayload.option, { notMerge: true });
            chart.on(
                'click',
                (params: { componentType?: string; dataIndex?: number }) => {
                    if (params.componentType !== 'yAxis') {
                        return;
                    }
                    const entry =
                        chartPayload.firstEntries[params.dataIndex ?? -1];
                    if (entry?.userId) {
                        openUserDialog({
                            userId: entry.userId,
                            title: entry.displayName || undefined,
                            seedData: knownUsersById[entry.userId] || null
                        });
                    }
                }
            );
        }

        renderChart().catch((error: unknown) => {
            console.error(
                '[PreviousInstancesTableDialog] Failed to load chart renderer.',
                error
            );
        });

        return () => {
            cancelled = true;
        };
    }, [
        chartElement,
        chartPayload,
        knownUsersById,
        resolvedTheme,
        timelineRows.length,
        topInset
    ]);

    if (!timelineRows.length) {
        return (
            <InfoChartEmptyState
                title={t(
                    'dialog.previous_instances.empty.no_player_detail_rows'
                )}
                description={t(
                    'dialog.previous_instances.empty.there_are_no_timeline_rows_for_this_instance'
                )}
            />
        );
    }

    return (
        <div className="relative w-full">
            {chartPayload ? (
                <div
                    className="absolute inset-x-0 z-10"
                    style={{
                        top: Math.max(
                            0,
                            infoChartFirstBarTop(
                                chartPayload.firstEntries.length,
                                topInset
                            ) -
                                AVATAR_LANE_GAP -
                                AVATAR_LANE_HEIGHT
                        )
                    }}
                >
                    <AvatarWearLane
                        segments={avatarSegments}
                        startMs={chartPayload.startMs}
                        endMs={chartPayload.endMs}
                        label={t('table.previous_instances.avatars')}
                    />
                </div>
            ) : null}
            <div
                ref={setInfoChartElementRef}
                className="w-full bg-transparent"
            />
        </div>
    );
}
