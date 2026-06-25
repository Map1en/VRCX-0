import { formatClock as formatAppClock, timeToText } from '@/lib/dateTime';

export const INFO_CHART_BAR_WIDTH = 12;

interface InfoChartRow {
    userId: string;
    displayName?: string;
    joinMs: number;
    leaveMs: number;
    durationMs: number;
    isFavorite?: boolean;
    isFriend?: boolean;
}

interface GroupedEntry {
    offset: number;
    durationMs: number;
    tail: number;
    entry: InfoChartRow;
}

function formatClock(value: any, hour12: any, includeSeconds: any = false) {
    return formatAppClock(value, { hour12, includeSeconds });
}

function truncateLabel(value: any, maxLength: any = 20) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function markerForEntry(entry: any) {
    if (entry?.isFavorite) {
        return '\u2b50 ';
    }
    if (entry?.isFriend) {
        return '\ud83d\udc9a ';
    }
    return '';
}

export function buildInfoChartTooltipParts(detailEntry: any, hour12: any) {
    return {
        title: `${detailEntry.displayName || ''} ${markerForEntry(detailEntry).trim()}`.trim(),
        timeRange: `${formatClock(detailEntry.joinMs, hour12, true)} - ${formatClock(detailEntry.leaveMs, hour12, true)}`,
        duration: timeToText(detailEntry.durationMs, true)
    };
}

export function buildInfoChartOption({
    rows,
    hour12,
    tooltipFormatter = null
}: any) {
    if (!rows.length) {
        return null;
    }

    const startMs = Math.min(...rows.map((entry: any) => entry.joinMs));
    const endMs = Math.max(...rows.map((entry: any) => entry.leaveMs));
    if (
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs
    ) {
        return null;
    }

    const groupedByUser = new Map<string, GroupedEntry[]>();
    const firstEntries: InfoChartRow[] = [];
    const sortedRows = [...rows].sort((left: any, right: any) => {
        const joinDiff = Math.abs(left.joinMs - right.joinMs);
        return joinDiff < 3000
            ? left.leaveMs - right.leaveMs
            : left.joinMs - right.joinMs;
    });

    for (const entry of sortedRows) {
        let entries = groupedByUser.get(entry.userId);
        if (!entries) {
            entries = [];
            groupedByUser.set(entry.userId, entries);
            firstEntries.push(entry);
        }
        const previous = entries[entries.length - 1];
        const offset = Math.max(
            0,
            previous
                ? entry.joinMs - startMs - previous.tail
                : entry.joinMs - startMs
        );
        const tail = previous
            ? previous.tail + offset + entry.durationMs
            : offset + entry.durationMs;
        entries.push({
            offset,
            durationMs: entry.durationMs,
            tail,
            entry
        });
    }

    const maxEntryCount = Math.max(
        ...Array.from(groupedByUser.values()).map(
            (entries: any) => entries.length
        )
    );
    const series = [];
    for (let entryIndex = 0; entryIndex < maxEntryCount; entryIndex += 1) {
        series.push({
            name: 'Placeholder',
            type: 'bar',
            stack: 'Total',
            itemStyle: {
                borderColor: 'transparent',
                color: 'transparent'
            },
            emphasis: {
                itemStyle: {
                    borderColor: 'transparent',
                    color: 'transparent'
                }
            },
            data: firstEntries.map((entry: any) => {
                const element = groupedByUser.get(entry.userId)?.[entryIndex];
                return element ? element.offset : 0;
            })
        });
        series.push({
            name: 'Time',
            type: 'bar',
            stack: 'Total',
            colorBy: 'data',
            barWidth: INFO_CHART_BAR_WIDTH,
            emphasis: {
                focus: 'self'
            },
            itemStyle: {
                borderRadius: 2,
                shadowBlur: 2,
                shadowOffsetX: 0.7,
                shadowOffsetY: 0.5
            },
            data: firstEntries.map((entry: any) => {
                const element = groupedByUser.get(entry.userId)?.[entryIndex];
                return element ? element.durationMs : 0;
            })
        });
    }

    return {
        option: {
            tooltip: {
                trigger: 'item',
                axisPointer: {
                    type: 'shadow'
                },
                formatter(params: any) {
                    if (params.seriesIndex % 2 === 0) {
                        return '';
                    }
                    const userEntry = firstEntries[params.dataIndex];
                    const detailEntry = groupedByUser.get(userEntry?.userId)?.[
                        Math.floor(params.seriesIndex / 2)
                    ]?.entry;
                    if (!detailEntry) {
                        return '';
                    }
                    if (tooltipFormatter) {
                        return tooltipFormatter(detailEntry, hour12);
                    }
                    const parts = buildInfoChartTooltipParts(
                        detailEntry,
                        hour12
                    );
                    return [parts.title, parts.timeRange, parts.duration]
                        .filter(Boolean)
                        .join('<br />');
                }
            },
            grid: {
                top: 50,
                left: 160,
                right: 90,
                bottom: 24
            },
            yAxis: {
                type: 'category',
                inverse: true,
                triggerEvent: true,
                axisLabel: {
                    interval: 0,
                    formatter(value: any, index: any) {
                        const entry = firstEntries[index];
                        return `${markerForEntry(entry)}${truncateLabel(value, 20)}`;
                    }
                },
                data: firstEntries.map((entry: any) => entry.displayName)
            },
            xAxis: {
                type: 'value',
                min: 0,
                max: endMs - startMs,
                axisLine: { show: true },
                axisLabel: {
                    formatter(value: any) {
                        return formatClock(startMs + value, hour12, false);
                    }
                },
                splitLine: {
                    lineStyle: {
                        type: 'dashed'
                    }
                }
            },
            series,
            backgroundColor: 'transparent'
        },
        firstEntries
    };
}
