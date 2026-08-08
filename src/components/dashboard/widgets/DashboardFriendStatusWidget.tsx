import type { EChartsType } from 'echarts/core';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import type { FriendRosterLoadStatus } from '@/domain/friends/friendRosterTypes';
import {
    buildFriendStatusDistribution,
    type FriendStatusDistributionEntry,
    type FriendStatusDistributionFriendMap
} from '@/domain/friends/friendStatusDistribution';
import { getResolvedThemeMode } from '@/services/themeService';
import { userStatusLabel } from '@/shared/utils/userStatus';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useShellStore } from '@/state/shellStore';
import { Spinner } from '@/ui/shadcn/spinner';

import { DashboardWidgetEmptyState } from './DashboardWidgetEmptyState';
import { DashboardWidgetHeader } from './DashboardWidgetHeader';

const STATUS_COLOR_FALLBACKS: Readonly<Record<string, string>> = Object.freeze({
    '--status-joinme': '#00b8ff',
    '--status-online': '#2ed319',
    '--status-askme': '#e97c03',
    '--status-busy': '#c80928'
});

type FriendStatusLegendEntry = FriendStatusDistributionEntry & {
    label: string;
};

export type DashboardFriendStatusWidgetViewProps = {
    friendsById?: FriendStatusDistributionFriendMap;
    onlineIds?: readonly unknown[];
    loadStatus?: FriendRosterLoadStatus;
    detail?: string;
};

function formatPercentage(value: number, locale?: string): string {
    return new Intl.NumberFormat(locale || undefined, {
        style: 'percent',
        maximumFractionDigits: 1
    }).format(value / 100);
}

function resolveStatusColor(element: HTMLElement, cssVariable: string): string {
    const resolved = getComputedStyle(element)
        .getPropertyValue(cssVariable)
        .trim();
    return resolved || STATUS_COLOR_FALLBACKS[cssVariable] || '#808080';
}

function buildFriendStatusDonutOption({
    entries,
    colors,
    locale
}: {
    entries: readonly FriendStatusLegendEntry[];
    colors: readonly string[];
    locale?: string;
}) {
    return {
        animationDuration: 250,
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item',
            confine: true,
            formatter(params: {
                name?: string;
                value?: number;
                percent?: number;
            }) {
                const count = Number(params.value) || 0;
                const percentage = Number(params.percent) || 0;
                return `${params.name || ''}: ${count} (${formatPercentage(
                    percentage,
                    locale
                )})`;
            }
        },
        series: [
            {
                name: 'Friend status',
                type: 'pie',
                radius: ['54%', '78%'],
                center: ['50%', '50%'],
                avoidLabelOverlap: true,
                stillShowZeroSum: false,
                label: { show: false },
                labelLine: { show: false },
                emphasis: {
                    scale: true,
                    scaleSize: 4
                },
                data: entries.map((entry, index) => ({
                    name: entry.label,
                    value: entry.count,
                    itemStyle: {
                        color: colors[index]
                    }
                }))
            }
        ]
    };
}

function FriendStatusWidgetShell({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full min-h-0 flex-col">
            <DashboardWidgetHeader
                title={t('dashboard.friend_status_widget')}
                icon="ri-pie-chart-line"
                path="/friends-locations"
            />
            {children}
        </div>
    );
}

export function DashboardFriendStatusWidgetView({
    friendsById = {},
    onlineIds = [],
    loadStatus = 'ready',
    detail = ''
}: DashboardFriendStatusWidgetViewProps) {
    const { t, i18n } = useTranslation();
    const shellThemeMode = useShellStore((state) => state.themeMode);
    const resolvedTheme = getResolvedThemeMode(shellThemeMode);
    const locale = i18n.resolvedLanguage || i18n.language || undefined;
    const distribution = useMemo(
        () => buildFriendStatusDistribution({ onlineIds, friendsById }),
        [friendsById, onlineIds]
    );
    const legendEntries = useMemo<FriendStatusLegendEntry[]>(
        () =>
            distribution.entries.map((entry) => ({
                ...entry,
                label: userStatusLabel(entry.status, t)
            })),
        [distribution.entries, t]
    );

    const [chartElement, setChartElement] = useState<HTMLDivElement | null>(
        null
    );
    const chartElementRef = useRef<HTMLDivElement | null>(null);
    const chartInstanceRef = useRef<EChartsType | null>(null);
    const chartThemeRef = useRef<string | null>(null);
    const echartsRef = useRef<typeof import('@/lib/echarts') | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    const setChartElementRef = useCallback((node: HTMLDivElement | null) => {
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
        if (!chartElement || distribution.total === 0) {
            return;
        }

        let cancelled = false;

        async function renderChart() {
            const echartsModule =
                echartsRef.current || (await import('@/lib/echarts'));
            if (
                cancelled ||
                !chartElement ||
                chartElementRef.current !== chartElement
            ) {
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
                    chartElement,
                    themeName || undefined
                );
                chart = nextChart;
                chartInstanceRef.current = nextChart;
                chartThemeRef.current = themeName;
                resizeObserverRef.current = new ResizeObserver(() => {
                    nextChart.resize();
                });
                resizeObserverRef.current.observe(chartElement);
            }

            const colors = legendEntries.map((entry) =>
                resolveStatusColor(chartElement, entry.cssVariable)
            );
            chart.setOption(
                buildFriendStatusDonutOption({
                    entries: legendEntries,
                    colors,
                    locale
                }),
                { notMerge: true }
            );
            chart.resize();
        }

        renderChart().catch((error: unknown) => {
            console.error(
                '[DashboardFriendStatusWidget] Failed to render chart.',
                error
            );
        });

        return () => {
            cancelled = true;
        };
    }, [
        chartElement,
        distribution.total,
        legendEntries,
        locale,
        resolvedTheme
    ]);

    if (
        distribution.total === 0 &&
        (loadStatus === 'idle' || loadStatus === 'running')
    ) {
        return (
            <FriendStatusWidgetShell>
                <div className="text-muted-foreground flex min-h-[180px] flex-1 items-center justify-center gap-2 text-sm">
                    <Spinner />
                    {t('view.dashboard.friend_status.loading')}
                </div>
            </FriendStatusWidgetShell>
        );
    }

    if (loadStatus === 'error') {
        return (
            <FriendStatusWidgetShell>
                <DashboardWidgetEmptyState
                    title={t('view.dashboard.friend_status.error')}
                    description={
                        detail ||
                        t(
                            'view.friends_locations.error.friend_roster_failed_to_load'
                        )
                    }
                />
            </FriendStatusWidgetShell>
        );
    }

    if (distribution.total === 0) {
        return (
            <FriendStatusWidgetShell>
                <DashboardWidgetEmptyState
                    title={t('view.dashboard.friend_status.empty')}
                    description={t(
                        'view.dashboard.friend_status.empty_description'
                    )}
                />
            </FriendStatusWidgetShell>
        );
    }

    return (
        <FriendStatusWidgetShell>
            <div className="flex min-h-[180px] flex-1 flex-wrap items-center justify-center gap-3 p-3">
                <div className="relative h-48 min-w-44 flex-1">
                    <div
                        ref={setChartElementRef}
                        className="size-full bg-transparent"
                        aria-hidden="true"
                    />
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-2xl leading-none font-semibold tabular-nums">
                            {distribution.total}
                        </span>
                        <span className="text-muted-foreground mt-1 max-w-24 text-[11px] leading-tight">
                            {t(
                                'view.dashboard.friend_status.total_online_friends'
                            )}
                        </span>
                    </div>
                </div>
                <ul
                    className="grid min-w-40 flex-1 gap-1.5"
                    aria-label={t('view.dashboard.friend_status.distribution')}
                >
                    {legendEntries.map((entry) => (
                        <li
                            key={entry.key}
                            data-status-tone={entry.key}
                            className="bg-muted/20 flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
                        >
                            <span
                                className="size-2.5 shrink-0 rounded-full"
                                style={{
                                    backgroundColor: `var(${entry.cssVariable})`
                                }}
                                aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">
                                {entry.label}
                            </span>
                            <span className="shrink-0 tabular-nums">
                                <span data-status-count={entry.count}>
                                    {entry.count}
                                </span>
                                <span
                                    className="text-muted-foreground px-1"
                                    aria-hidden="true"
                                >
                                    /
                                </span>
                                <span
                                    data-status-percentage={formatPercentage(
                                        entry.percentage,
                                        locale
                                    )}
                                >
                                    {formatPercentage(entry.percentage, locale)}
                                </span>
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </FriendStatusWidgetShell>
    );
}

export function DashboardFriendStatusWidget() {
    const { friendsById, onlineIds, loadStatus, detail } = useFriendRosterStore(
        useShallow((state) => ({
            friendsById: state.friendsById,
            onlineIds: state.onlineIds,
            loadStatus: state.loadStatus,
            detail: state.detail
        }))
    );

    return (
        <DashboardFriendStatusWidgetView
            friendsById={friendsById}
            onlineIds={onlineIds}
            loadStatus={loadStatus}
            detail={detail}
        />
    );
}
