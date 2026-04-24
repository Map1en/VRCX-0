import * as echarts from 'echarts';
import { useCallback, useEffect, useRef } from 'react';

import { useTranslation } from 'react-i18next';
import {
    EmptyState as AppEmptyState,
    LoadingState as AppLoadingState
} from '@/components/layout/PageScaffold.jsx';
import { Location } from '@/components/Location.jsx';
import { openUserDialog } from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';

import {
    buildDetailChartOption,
    formatClock
} from '../instance-activity/instanceActivityChart.js';

export function ChartLoadingState() {
    const { t } = useTranslation();

    return (
        <AppLoadingState
            className="min-h-80"
            label={t('view.charts.generated.loading_instance_activity')}
        />
    );
}

export function ChartEmptyState({ title, description }) {
    return (
        <AppEmptyState
            className="min-h-80"
            title={title}
            description={description}
            contentClassName="max-w-md"
        />
    );
}

export function InstanceActivityDetailChart({
    group,
    barWidth,
    hour12,
    resolvedTheme,
    worldDetailsById,
    onOpenPreviousInstanceInfo
}) {
    const { t } = useTranslation();

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
    const world = parsedLocation.worldId
        ? worldDetailsById[parsedLocation.worldId]
        : null;
    const worldName = world?.name || '';
    const currentUserEntry = group.find((entry) => entry.isCurrentUser);

    function openPreviousInstanceInfo() {
        if (!location) {
            return;
        }
        const firstEntry = currentUserEntry || group[0] || {};
        const startMs = Number.isFinite(firstEntry.joinMs)
            ? firstEntry.joinMs
            : Math.min(
                  ...group.map((entry) => entry.joinMs).filter(Number.isFinite)
              );
        const endMs = Number.isFinite(firstEntry.leaveMs)
            ? firstEntry.leaveMs
            : Math.max(
                  ...group.map((entry) => entry.leaveMs).filter(Number.isFinite)
              );
        onOpenPreviousInstanceInfo?.({
            location,
            worldName,
            groupName: parsedLocation.groupId || '',
            created_at: Number.isFinite(endMs)
                ? new Date(endMs).toISOString()
                : '',
            time:
                Number.isFinite(startMs) && Number.isFinite(endMs)
                    ? Math.max(0, endMs - startMs)
                    : 0
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

        const themeName = resolvedTheme === 'dark' ? 'dark' : null;
        let chart = chartInstanceRef.current;
        if (!chart || chartThemeRef.current !== themeName) {
            resizeObserverRef.current?.disconnect();
            chart?.dispose();

            chart = echarts.init(
                chartElementRef.current,
                themeName || undefined
            );
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
        const chartHeight = Math.max(
            180,
            firstEntries.length * (barWidth + 10) + 110
        );
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
                    <div className="text-muted-foreground shrink-0">
                        {formatClock(currentUserEntry.joinMs, hour12, true)} -{' '}
                        {formatClock(currentUserEntry.leaveMs, hour12, true)}
                    </div>
                ) : null}
            </div>
            {group.length ? (
                <div ref={setDetailChartElementRef} className="w-full" />
            ) : (
                <ChartEmptyState
                    title={t('view.charts.generated.no_detail_rows')}
                    description={t('view.charts.generated.no_matching_player_activity_rows_were_found_for_this_instanc')}
                />
            )}
        </div>
    );
}
