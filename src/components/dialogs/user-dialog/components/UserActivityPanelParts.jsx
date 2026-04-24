import * as echarts from 'echarts';
import { ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { timeToText } from '@/lib/dateTime.js';
import { cn } from '@/lib/utils.js';
import { openWorldDialog } from '@/services/dialogService.js';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';

function toHeatmapSeriesData(normalizedBuckets, weekStartsOn) {
    const data = [];
    for (let day = 0; day < 7; day += 1) {
        for (let hour = 0; hour < 24; hour += 1) {
            const slot = day * 24 + hour;
            const displayDay = (day - weekStartsOn + 7) % 7;
            data.push([hour, displayDay, normalizedBuckets?.[slot] || 0]);
        }
    }
    return data;
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
}) {
    return {
        tooltip: {
            confine: true,
            position: 'top',
            formatter: (params) => {
                const [hour, dayIndex] = params.data;
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
    onContextMenu
}) {
    const [chartElement, setChartElement] = useState(null);
    const chartInstanceRef = useRef(null);
    const chartThemeRef = useRef(null);
    const resizeObserverRef = useRef(null);
    const renderTimerRef = useRef(null);

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

        const renderChart = () => {
            const themeName = isDarkMode ? 'dark' : null;
            let chart = chartInstanceRef.current;

            if (!chart || chartThemeRef.current !== themeName) {
                resizeObserverRef.current?.disconnect();
                chart?.dispose();
                chart = echarts.init(chartElement, themeName || undefined, {
                    height: 240
                });
                chartInstanceRef.current = chart;
                chartThemeRef.current = themeName;
                resizeObserverRef.current = new ResizeObserver(() => {
                    chart.resize();
                });
                resizeObserverRef.current.observe(chartElement);
            }

            chartElement.style.height = '240px';
            chart.resize({ height: 240 });

            if (!normalizedBuckets.length) {
                chart.clear();
                return;
            }

            chart.setOption(
                buildHeatmapOption({
                    data: toHeatmapSeriesData(normalizedBuckets, weekStartsOn),
                    rawBuckets,
                    dayLabels,
                    hourLabels,
                    weekStartsOn,
                    isDarkMode,
                    emptyColor,
                    scaleColors,
                    unitLabel
                }),
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
        chartElement,
        dayLabels,
        emptyColor,
        hourLabels,
        isDarkMode,
        normalizedBuckets,
        rawBuckets,
        renderDelay,
        scaleColors,
        unitLabel,
        weekStartsOn
    ]);

    return (
        <div
            ref={setChartElement}
            className="min-w-0 overflow-hidden"
            style={{ width: '100%', height: 240 }}
            onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu?.();
            }}
        />
    );
}

export function getWorldThumbnailUrl(world) {
    const url = world?.thumbnailImageUrl || world?.imageUrl || '';
    return url ? url.replace('256', '128') : '';
}

export function ActivityEmptyState({ title, description }) {
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

export function TopWorldRows({ worlds, sortBy, t }) {
    const key = sortBy === 'count' ? 'visitCount' : 'totalTime';
    const maxValue = Math.max(...worlds.map((world) => world[key] || 0), 0);

    if (!worlds.length) {
        return null;
    }

    return (
        <div className="flex flex-col gap-0.5">
            {worlds.map((world, index) => {
                const value = world[key] || 0;
                const thumbnailUrl = getWorldThumbnailUrl(world);
                const barWidth =
                    maxValue > 0
                        ? `${Math.max((value / maxValue) * 100, 8)}%`
                        : '0%';
                return (
                    <Button
                        key={world.worldId || index}
                        type="button"
                        variant="ghost"
                        className={cn(
                            'h-auto w-full items-start justify-start gap-3 rounded-lg px-3 py-2 text-left font-normal transition-colors',
                            index === 0 ? 'bg-primary/5' : ''
                        )}
                        onClick={() =>
                            openWorldDialog({
                                worldId: world.worldId,
                                title: world.worldName || undefined
                            })
                        }
                    >
                        <span
                            className={cn(
                                'mt-1 w-5 shrink-0 text-right font-mono text-xs font-bold',
                                index === 0
                                    ? 'text-primary'
                                    : 'text-muted-foreground'
                            )}
                        >
                            #{index + 1}
                        </span>
                        <Avatar className="mt-0.5 size-8 shrink-0 rounded-sm">
                            {thumbnailUrl ? (
                                <AvatarImage
                                    src={thumbnailUrl}
                                    loading="lazy"
                                    decoding="async"
                                    className="rounded-sm object-cover"
                                />
                            ) : null}
                            <AvatarFallback className="rounded-sm [&>svg]:size-3.5">
                                <ImageIcon className="text-muted-foreground" />
                            </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-sm font-medium">
                                    {world.worldName || 'World'}
                                </span>
                                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                                    {sortBy === 'time'
                                        ? timeToText(world.totalTime || 0)
                                        : t(
                                              'dialog.user.activity.most_visited_worlds.visit_count_label',
                                              {
                                                  count: world.visitCount || 0
                                              }
                                          )}
                                </span>
                            </span>
                            <span className="bg-muted mt-1 block h-1.5 w-full overflow-hidden rounded-full">
                                <span
                                    className="bg-muted-foreground/45 block h-full rounded-full transition-all duration-500"
                                    style={{ width: barWidth }}
                                />
                            </span>
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}
