import type { EChartsType } from 'echarts/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '@/lib/dateTime';
import { echarts } from '@/lib/echarts';
import type {
    ActivityPageSeries,
    ActivitySeriesPoint
} from '@/platform/tauri/bindings';
import { useShellStore } from '@/state/shellStore';

import { parseLocalDate } from '../activityPageModel';
import {
    useActivityPalette,
    type ActivityPalette
} from '../useActivityPalette';

const CHART_HEIGHT = 210;

function formatSeriesDate(dateKey: string, isoFormat: boolean): string {
    return isoFormat
        ? dateKey.slice(5)
        : formatDateTime(parseLocalDate(dateKey), {
              month: '2-digit',
              day: '2-digit'
          });
}

export function formatSeriesPointRange(
    point: ActivitySeriesPoint,
    isoFormat: boolean
): string {
    const start = formatSeriesDate(point.startDate, isoFormat);
    return point.endDate === point.startDate
        ? start
        : `${start}–${formatSeriesDate(point.endDate, isoFormat)}`;
}

function formatHours(minutes: number, hoursLabel: string): string {
    return `${(minutes / 60).toFixed(1)}${hoursLabel}`;
}

function buildOption({
    series,
    palette,
    hoursLabel,
    isoFormat,
    ariaDescription
}: {
    series: ActivityPageSeries;
    palette: ActivityPalette;
    hoursLabel: string;
    isoFormat: boolean;
    ariaDescription: string;
}) {
    return {
        backgroundColor: 'transparent',
        animationDuration: 700,
        animationDelay: (index: number) => index * 8,
        animationEasing: 'cubicOut' as const,
        aria: {
            enabled: true,
            label: { description: ariaDescription }
        },
        tooltip: {
            confine: true,
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            borderWidth: 0,
            formatter: (params: unknown) => {
                const entries = Array.isArray(params) ? params : [params];
                const first = entries[0] as { dataIndex?: number } | undefined;
                const point = series.points[first?.dataIndex ?? -1];
                if (!point) {
                    return '';
                }
                const hours = (point.minutes / 60).toFixed(1);
                return `${formatSeriesPointRange(point, isoFormat)}<br/><b>${hours}</b>${hoursLabel}`;
            }
        },
        grid: { top: 10, left: 38, right: 6, bottom: 24 },
        xAxis: {
            type: 'category',
            data: series.points.map((point) => point.startDate),
            axisTick: { show: false },
            axisLine: { lineStyle: { color: palette['act-edge'] } },
            axisLabel: {
                color: palette['act-axis'],
                fontSize: 10,
                hideOverlap: true,
                formatter: (value: string) => formatSeriesDate(value, isoFormat)
            }
        },
        yAxis: {
            type: 'value',
            splitNumber: 3,
            axisLabel: {
                color: palette['act-axis'],
                fontSize: 10,
                formatter: (value: number) =>
                    `${Math.round(value / 60)}${hoursLabel}`
            },
            splitLine: {
                lineStyle: { color: palette['act-edge'], type: 'dashed' }
            }
        },
        series: [
            {
                type: 'bar',
                data: series.points.map((point) => point.minutes),
                barMaxWidth: 18,
                cursor: 'pointer',
                itemStyle: {
                    borderRadius: 3,
                    color: palette['act-mark']
                },
                emphasis: { itemStyle: { opacity: 0.75 } }
            }
        ]
    };
}

export function ActivitySeriesChart({
    series,
    label,
    isDarkMode,
    onSelectPoint
}: {
    series: ActivityPageSeries;
    label: string;
    isDarkMode: boolean;
    onSelectPoint?: (point: ActivitySeriesPoint) => void;
}) {
    const { t } = useTranslation();
    const isoFormat = useShellStore((state) => state.dateIsoFormat);
    const [chartElement, setChartElement] = useState<HTMLDivElement | null>(
        null
    );
    const chartRef = useRef<EChartsType | null>(null);
    const themeRef = useRef<string | null>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    const pointsRef = useRef(series.points);
    const onSelectPointRef = useRef(onSelectPoint);
    const palette = useActivityPalette(chartElement, isDarkMode);

    useEffect(() => {
        pointsRef.current = series.points;
        onSelectPointRef.current = onSelectPoint;
    }, [onSelectPoint, series.points]);

    useEffect(
        () => () => {
            observerRef.current?.disconnect();
            chartRef.current?.dispose();
            observerRef.current = null;
            chartRef.current = null;
            themeRef.current = null;
        },
        []
    );

    const hoursLabel = t('view.activity.unit.hours');
    const summary = summarizeSeries(series, hoursLabel, isoFormat);
    const ariaDescription = summary
        ? t('view.activity.chart.series_summary', { label, ...summary })
        : label;

    useEffect(() => {
        if (!chartElement || !palette || series.points.length === 0) {
            return;
        }
        const themeName = isDarkMode ? 'dark' : null;
        let chart = chartRef.current;

        if (!chart || themeRef.current !== themeName) {
            observerRef.current?.disconnect();
            chart?.dispose();
            const next = echarts.init(chartElement, themeName || undefined, {
                height: CHART_HEIGHT
            });
            next.on('click', { seriesIndex: 0 }, (params) => {
                const point = pointsRef.current[params.dataIndex];
                if (point && point.minutes > 0) {
                    onSelectPointRef.current?.(point);
                }
            });
            chart = next;
            chartRef.current = next;
            themeRef.current = themeName;
            observerRef.current = new ResizeObserver(() => {
                next.resize();
            });
            observerRef.current.observe(chartElement);
        }

        chart.setOption(
            buildOption({
                series,
                palette,
                hoursLabel,
                isoFormat,
                ariaDescription
            }),
            {
                replaceMerge: ['series', 'xAxis']
            }
        );
    }, [
        ariaDescription,
        chartElement,
        hoursLabel,
        isDarkMode,
        isoFormat,
        palette,
        series
    ]);

    if (series.points.length === 0) {
        return null;
    }

    return (
        <div
            ref={setChartElement}
            className="min-w-0 shrink-0 overflow-hidden"
            style={{ width: '100%', height: CHART_HEIGHT }}
        />
    );
}

function summarizeSeries(
    series: ActivityPageSeries,
    hoursLabel: string,
    isoFormat: boolean
) {
    const first = series.points[0];
    const last = series.points[series.points.length - 1];
    if (!first || !last) {
        return null;
    }
    const peak = series.points.reduce((best, point) =>
        point.minutes > best.minutes ? point : best
    );
    const total = series.points.reduce((sum, point) => sum + point.minutes, 0);
    return {
        from: formatSeriesDate(first.startDate, isoFormat),
        to: formatSeriesDate(last.endDate, isoFormat),
        total: formatHours(total, hoursLabel),
        peak: formatSeriesPointRange(peak, isoFormat),
        peakHours: formatHours(peak.minutes, hoursLabel)
    };
}
