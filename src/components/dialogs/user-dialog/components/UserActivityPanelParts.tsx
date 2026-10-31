import type { EChartsType } from 'echarts/core';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { echarts } from '@/lib/echarts';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';

type HeatmapPoint = [number, number, number];

const DEFAULT_HEIGHT = 240;
const GRID_LEFT = 42;
const GRID_RIGHT = 16;
const GRID_TOP = 6;
const GRID_BOTTOM = 32;

function squareGridHeight(width: number) {
    const plotWidth = width - GRID_LEFT - GRID_RIGHT;
    if (plotWidth <= 0) {
        return DEFAULT_HEIGHT;
    }
    return Math.round((plotWidth / 24) * 7) + GRID_TOP + GRID_BOTTOM;
}

function toHeatmapSeriesData(
    normalizedBuckets: readonly number[],
    weekStartsOn: number
) {
    const data: HeatmapPoint[] = [];
    for (let day = 0; day < 7; day += 1) {
        for (let hour = 0; hour < 24; hour += 1) {
            const slot = day * 24 + hour;
            const displayDay = (day - weekStartsOn + 7) % 7;
            data.push([hour, displayDay, normalizedBuckets?.[slot] || 0]);
        }
    }
    return data;
}

interface HeatmapOptionInput {
    data: HeatmapPoint[];
    rawBuckets: readonly number[];
    dayLabels: readonly string[];
    hourLabels: readonly string[];
    weekStartsOn: number;
    isDarkMode: boolean;
    emptyColor: string;
    scaleColors: readonly string[];
    unitLabel: string;
}

function buildHeatmapOption({
    data,
    rawBuckets,
    dayLabels,
    hourLabels,
    weekStartsOn,
    isDarkMode,
    emptyColor,
    scaleColors,
    unitLabel
}: HeatmapOptionInput) {
    return {
        tooltip: {
            confine: true,
            position: 'top',
            formatter: (params: { data?: unknown }) => {
                const point = Array.isArray(params.data) ? params.data : [];
                const hour = Number(point[0]) || 0;
                const dayIndex = Number(point[1]) || 0;
                const originalDay = (dayIndex + weekStartsOn) % 7;
                const slot = originalDay * 24 + hour;
                const minutes = Math.round(rawBuckets?.[slot] || 0);
                return `${dayLabels[dayIndex]} ${hourLabels[hour]}<br/><b>${minutes}</b> ${unitLabel}`;
            }
        },
        grid: {
            top: 6,
            left: 42,
            right: 16,
            bottom: 32
        },
        xAxis: {
            type: 'category',
            data: hourLabels,
            splitArea: { show: false },
            axisLabel: {
                interval: 2,
                fontSize: 10
            },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'category',
            data: dayLabels,
            inverse: true,
            splitArea: { show: false },
            axisLabel: {
                fontSize: 11
            },
            axisTick: { show: false }
        },
        visualMap: {
            min: 0,
            max: 1,
            calculable: false,
            show: false,
            type: 'piecewise',
            dimension: 2,
            pieces: [
                { min: 0, max: 0, color: emptyColor },
                { gt: 0, lte: 0.2, color: scaleColors[0] },
                { gt: 0.2, lte: 0.4, color: scaleColors[1] },
                { gt: 0.4, lte: 0.6, color: scaleColors[2] },
                { gt: 0.6, lte: 0.8, color: scaleColors[3] },
                { gt: 0.8, lte: 1, color: scaleColors[4] }
            ]
        },
        series: [
            {
                type: 'heatmap',
                data,
                emphasis: {
                    itemStyle: {
                        borderColor: isDarkMode
                            ? 'hsl(220, 15%, 18%)'
                            : 'hsl(210, 18%, 78%)',
                        borderWidth: 1.5,
                        opacity: 0.92
                    }
                },
                itemStyle: {
                    borderWidth: 1.5,
                    borderColor: isDarkMode
                        ? 'hsl(220, 15%, 8%)'
                        : 'hsl(0, 0%, 100%)',
                    borderRadius: 2
                }
            }
        ],
        backgroundColor: 'transparent'
    };
}

export function HeatmapChart({
    rawBuckets = [],
    normalizedBuckets = [],
    dayLabels,
    hourLabels,
    weekStartsOn,
    isDarkMode,
    emptyColor,
    scaleColors,
    unitLabel,
    renderDelay = 0,
    squareCells = false,
    ariaDescription,
    onContextMenu
}: {
    rawBuckets?: number[];
    normalizedBuckets?: number[];
    dayLabels: string[];
    hourLabels: string[];
    weekStartsOn: number;
    isDarkMode: boolean;
    emptyColor: string;
    scaleColors: string[];
    unitLabel: string;
    renderDelay?: number;
    squareCells?: boolean;
    ariaDescription?: string;
    onContextMenu?: () => void;
}) {
    const [chartElement, setChartElement] = useState<HTMLDivElement | null>(
        null
    );
    const chartInstanceRef = useRef<EChartsType | null>(null);
    const chartThemeRef = useRef<string | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
        () => () => {
            if (renderTimerRef.current !== null) {
                clearTimeout(renderTimerRef.current);
                renderTimerRef.current = null;
            }
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
            return undefined;
        }

        if (renderTimerRef.current !== null) {
            clearTimeout(renderTimerRef.current);
            renderTimerRef.current = null;
        }

        const resolveHeight = () =>
            squareCells
                ? squareGridHeight(chartElement.clientWidth)
                : DEFAULT_HEIGHT;

        const renderChart = () => {
            const themeName = isDarkMode ? 'dark' : null;
            let chart = chartInstanceRef.current;

            if (!chart || chartThemeRef.current !== themeName) {
                resizeObserverRef.current?.disconnect();
                chart?.dispose();
                const nextChart = echarts.init(
                    chartElement,
                    themeName || undefined,
                    {
                        height: resolveHeight()
                    }
                );
                chart = nextChart;
                chartInstanceRef.current = nextChart;
                chartThemeRef.current = themeName;
                resizeObserverRef.current = new ResizeObserver(() => {
                    const nextHeight = resolveHeight();
                    chartElement.style.height = `${nextHeight}px`;
                    nextChart.resize({ height: nextHeight });
                });
                resizeObserverRef.current.observe(chartElement);
            }

            if (!chart) {
                return;
            }

            const height = resolveHeight();
            chartElement.style.height = `${height}px`;
            chart.resize({ height });

            if (!normalizedBuckets.length) {
                chart.clear();
                return;
            }

            chart.setOption(
                {
                    ...buildHeatmapOption({
                        data: toHeatmapSeriesData(
                            normalizedBuckets,
                            weekStartsOn
                        ),
                        rawBuckets,
                        dayLabels,
                        hourLabels,
                        weekStartsOn,
                        isDarkMode,
                        emptyColor,
                        scaleColors,
                        unitLabel
                    }),
                    ...(ariaDescription
                        ? {
                              aria: {
                                  enabled: true,
                                  label: { description: ariaDescription }
                              }
                          }
                        : {})
                },
                { replaceMerge: ['series'] }
            );
        };

        if (renderDelay > 0) {
            renderTimerRef.current = setTimeout(() => {
                renderTimerRef.current = null;
                renderChart();
            }, renderDelay);
        } else {
            renderChart();
        }

        return () => {
            if (renderTimerRef.current !== null) {
                clearTimeout(renderTimerRef.current);
                renderTimerRef.current = null;
            }
        };
    }, [
        ariaDescription,
        chartElement,
        dayLabels,
        emptyColor,
        hourLabels,
        isDarkMode,
        normalizedBuckets,
        rawBuckets,
        renderDelay,
        scaleColors,
        squareCells,
        unitLabel,
        weekStartsOn
    ]);

    return (
        <div
            ref={setChartElement}
            className="min-w-0 shrink-0 overflow-hidden"
            style={{ width: '100%', height: DEFAULT_HEIGHT }}
            onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu?.();
            }}
        />
    );
}

export function ActivityEmptyState({
    title,
    description
}: {
    title: ReactNode;
    description?: ReactNode;
}) {
    return (
        <Empty className="mt-8 min-h-40 border">
            <EmptyHeader>
                <EmptyTitle>{title}</EmptyTitle>
                {description ? (
                    <EmptyDescription>{description}</EmptyDescription>
                ) : null}
            </EmptyHeader>
        </Empty>
    );
}
