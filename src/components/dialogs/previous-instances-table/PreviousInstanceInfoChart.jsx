import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openUserDialog } from '@/services/dialogService.js';
import { getResolvedThemeMode } from '@/services/themeService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';

import {
    INFO_CHART_BAR_WIDTH,
    buildInfoChartOption,
    buildInfoChartTooltipParts
} from './previousInstancesChart.js';
import { normalizeInfoChartRows } from './previousInstancesRows.js';

function InfoChartEmptyState({ title, description }) {
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
function createInfoChartTooltipElement(detailEntry, hour12) {
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

export function PreviousInstanceInfoChart({ rows }) {
    const { t } = useTranslation();

    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
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

    const [chartElement, setChartElement] = useState(null);
    const chartElementRef = useRef(null);
    const chartInstanceRef = useRef(null);
    const chartThemeRef = useRef(null);
    const echartsRef = useRef(null);
    const resizeObserverRef = useRef(null);

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
    const chartRows = useMemo(
        () =>
            normalizeInfoChartRows(
                rows,
                currentUserId,
                friendsById,
                favoriteIdSet
            ),
        [currentUserId, favoriteIdSet, friendsById, rows]
    );
    const chartPayload = useMemo(
        () =>
            buildInfoChartOption({
                rows: chartRows,
                hour12,
                tooltipFormatter: createInfoChartTooltipElement
            }),
        [chartRows, hour12]
    );

    const setInfoChartElementRef = useCallback((node) => {
        if (chartElementRef.current && chartElementRef.current !== node) {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
            chartThemeRef.current = null;
        }
        chartElementRef.current = node;
        setChartElement(node);
    }, []);

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
        if (!chartElement) {
            return;
        }

        let cancelled = false;

        async function renderChart() {
            const echarts = echartsRef.current || (await import('echarts'));
            if (cancelled || chartElementRef.current !== chartElement) {
                return;
            }
            echartsRef.current = echarts;

            const themeName = resolvedTheme === 'dark' ? 'dark' : null;
            let chart = chartInstanceRef.current;

            if (!chart || chartThemeRef.current !== themeName) {
                resizeObserverRef.current?.disconnect();
                chart?.dispose();

                chart = echarts.init(chartElement, themeName || undefined, {
                    useDirtyRect: chartRows.length > 80
                });
                chartInstanceRef.current = chart;
                chartThemeRef.current = themeName;

                resizeObserverRef.current = new ResizeObserver(() => {
                    chart.resize();
                });
                resizeObserverRef.current.observe(chartElement);
            }

            const chartRowCount =
                chartPayload?.firstEntries.length || chartRows.length;
            const chartHeight = Math.max(
                220,
                chartRowCount * (INFO_CHART_BAR_WIDTH + 10) + 200
            );
            chartElement.style.height = `${chartHeight}px`;
            chart.resize({ height: chartHeight });
            chart.off('click');

            if (!chartPayload) {
                chart.clear();
                return;
            }

            chart.clear();
            chart.setOption(chartPayload.option, { notMerge: true });
            chart.on('click', (params) => {
                if (params.componentType !== 'yAxis') {
                    return;
                }
                const entry = chartPayload.firstEntries[params.dataIndex];
                if (entry?.userId) {
                    openUserDialog({
                        userId: entry.userId,
                        title: entry.displayName || undefined
                    });
                }
            });
        }

        renderChart().catch((error) => {
            console.error(
                '[PreviousInstancesTableDialog] Failed to load chart renderer.',
                error
            );
        });

        return () => {
            cancelled = true;
        };
    }, [chartElement, chartPayload, chartRows.length, resolvedTheme]);

    if (!chartRows.length) {
        return (
            <InfoChartEmptyState
                title={t(
                    'dialog.previous_instances.generated.no_player_detail_rows'
                )}
                description={t(
                    'dialog.previous_instances.generated.there_are_no_timeline_rows_for_this_instance'
                )}
            />
        );
    }

    return (
        <div ref={setInfoChartElementRef} className="w-full bg-transparent" />
    );
}
