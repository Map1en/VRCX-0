import type { EChartsType } from 'echarts/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AssistantChart, UIToolCall } from '@/domain/assistant/types';
import {
    useActivityPalette,
    type ActivityPalette
} from '@/features/activity/useActivityPalette';
import { formatDateTime } from '@/lib/dateTime';
import { echarts } from '@/lib/echarts';
import { getResolvedThemeMode } from '@/services/themeService';
import { useShellStore } from '@/state/shellStore';
import { Button } from '@/ui/shadcn/button';

import { useNearViewport } from '../useNearViewport';

const VISIBLE_CHART_LIMIT = 2;
const COLUMN_CHART_HEIGHT = 180;
const RANKING_ROW_HEIGHT = 24;
const MINUTE_KINDS = new Set<AssistantChart['kind']>([
    'myPlaytime',
    'topCompanions',
    'topWorlds',
    'sharedWorlds'
]);
const TITLE_KEYS: Record<AssistantChart['kind'], string> = {
    myPlaytime: 'assistant.chart.my_playtime',
    bestTimes: 'assistant.chart.best_times',
    friendPattern: 'assistant.chart.friend_pattern',
    topCompanions: 'assistant.chart.top_companions',
    topWorlds: 'assistant.chart.top_worlds',
    sharedWorlds: 'assistant.chart.shared_worlds'
};
const RANKING_KINDS = new Set<AssistantChart['kind']>([
    'bestTimes',
    'topCompanions',
    'topWorlds',
    'sharedWorlds'
]);

function chartHeight(chart: AssistantChart): number {
    return RANKING_KINDS.has(chart.kind)
        ? Math.max(96, chart.points.length * RANKING_ROW_HEIGHT + 16)
        : COLUMN_CHART_HEIGHT;
}

function pointLabel(chart: AssistantChart, key: string): string {
    if (chart.axis === 'hourOfDay') {
        return `${key.padStart(2, '0')}:00`;
    }
    if (chart.axis === 'dayOfWeek') {
        return formatDateTime(new Date(2024, 0, 1 + Number(key)), {
            weekday: 'short'
        });
    }
    return key;
}

function buildOption(
    chart: AssistantChart,
    palette: ActivityPalette,
    hoursUnit: string
) {
    const minutes = MINUTE_KINDS.has(chart.kind);
    const ranking = RANKING_KINDS.has(chart.kind);
    const unit = minutes ? hoursUnit : '';
    const values = chart.points.map((point) =>
        minutes ? Math.round(point.value / 6) / 10 : point.value
    );
    const labels = chart.points.map((point) => pointLabel(chart, point.key));
    const categoryAxis = {
        type: 'category' as const,
        data: labels,
        inverse: ranking,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: palette['act-edge'] } },
        axisLabel: {
            color: palette['act-axis'],
            fontSize: 10,
            hideOverlap: !ranking,
            width: ranking ? 120 : undefined,
            overflow: ranking ? ('truncate' as const) : undefined
        }
    };
    const valueAxis = {
        type: 'value' as const,
        splitNumber: 3,
        axisLabel: {
            color: palette['act-axis'],
            fontSize: 10,
            formatter: (value: number) => `${value}${unit}`
        },
        splitLine: {
            lineStyle: { color: palette['act-edge'], type: 'dashed' as const }
        }
    };
    return {
        backgroundColor: 'transparent',
        animationDuration: 500,
        tooltip: {
            confine: true,
            trigger: 'axis' as const,
            axisPointer: { type: 'shadow' as const },
            borderWidth: 0,
            formatter: (params: unknown) => {
                const first = (Array.isArray(params) ? params[0] : params) as
                    | { dataIndex?: number }
                    | undefined;
                const index = first?.dataIndex ?? -1;
                return index in values
                    ? `${echarts.format.encodeHTML(labels[index])}<br/><b>${values[index]}${unit}</b>`
                    : '';
            }
        },
        grid: ranking
            ? { top: 4, left: 4, right: 12, bottom: 4, containLabel: true }
            : { top: 10, left: 4, right: 6, bottom: 4, containLabel: true },
        xAxis: ranking ? valueAxis : categoryAxis,
        yAxis: ranking ? categoryAxis : valueAxis,
        series: [
            {
                type: 'bar' as const,
                data: values,
                barMaxWidth: ranking ? 14 : 18,
                itemStyle: {
                    borderRadius: 3,
                    color: palette['act-mark']
                },
                emphasis: {
                    itemStyle: { color: palette['act-mark'], opacity: 0.8 }
                }
            }
        ]
    };
}

function ChartCanvas({
    chart,
    height
}: {
    chart: AssistantChart;
    height: number;
}) {
    const { t } = useTranslation();
    const themeMode = useShellStore((state) => state.themeMode);
    const isDarkMode = getResolvedThemeMode(themeMode) === 'dark';
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    const palette = useActivityPalette(element, isDarkMode);
    const chartRef = useRef<EChartsType | null>(null);
    const hoursUnit = t('view.activity.unit.hours');

    useEffect(() => {
        if (!element) {
            return;
        }
        const instance = echarts.init(
            element,
            isDarkMode ? 'dark' : undefined,
            { height }
        );
        chartRef.current = instance;
        const observer = new ResizeObserver(() => instance.resize());
        observer.observe(element);
        return () => {
            observer.disconnect();
            instance.dispose();
            chartRef.current = null;
        };
    }, [element, height, isDarkMode]);

    useEffect(() => {
        if (palette) {
            chartRef.current?.setOption(
                buildOption(chart, palette, hoursUnit),
                { notMerge: true }
            );
        }
    }, [chart, element, height, hoursUnit, palette]);

    return <div ref={setElement} className="size-full" />;
}

function AssistantChartCard({ chart }: { chart: AssistantChart }) {
    const { t } = useTranslation();
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    const near = useNearViewport(element);
    const height = chartHeight(chart);

    return (
        <figure className="activity-skin border-border/60 min-w-0 rounded-xl border px-3 py-2.5">
            <figcaption className="text-muted-foreground mb-1.5 text-xs font-medium">
                {t(TITLE_KEYS[chart.kind], {
                    name: chart.subject ?? ''
                })}
            </figcaption>
            <div ref={setElement} style={{ height }}>
                {near && <ChartCanvas chart={chart} height={height} />}
            </div>
        </figure>
    );
}

export function AssistantCharts({
    toolCalls
}: {
    toolCalls: readonly UIToolCall[];
}) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const charts = useMemo(() => {
        const latestByTool = new Map<string, AssistantChart[]>();
        for (const call of toolCalls) {
            if (call.charts.length > 0) {
                latestByTool.delete(call.name);
                latestByTool.set(call.name, call.charts);
            }
        }
        return [...latestByTool.values()].flat();
    }, [toolCalls]);

    if (charts.length === 0) {
        return null;
    }
    const hidden = charts.length - VISIBLE_CHART_LIMIT;
    const visible = expanded ? charts : charts.slice(0, VISIBLE_CHART_LIMIT);

    return (
        <div className="flex w-full flex-col gap-2">
            {visible.map((chart, index) => (
                <AssistantChartCard
                    key={`${chart.kind}-${index}`}
                    chart={chart}
                />
            ))}
            {!expanded && hidden > 0 && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground self-start"
                    onClick={() => setExpanded(true)}
                >
                    {t('assistant.chart.show_more', { count: hidden })}
                </Button>
            )}
        </div>
    );
}
