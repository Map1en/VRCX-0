import { formatClock as formatAppClock, timeToText } from '@/lib/dateTime';

import type { PreviousInstanceVisitWindow } from './previousInstancesRows';

export const INFO_CHART_BAR_WIDTH = 12;
const VISIT_BOUNDARY_TOLERANCE_MS = 60 * 1000;

export interface InfoChartRow {
    userId: string;
    displayName?: string;
    joinMs: number;
    leaveMs: number;
    durationMs: number;
    isSelf?: boolean;
    isFavorite?: boolean;
    isFriend?: boolean;
}

type InfoChartTooltipRow = Omit<InfoChartRow, 'userId'> & {
    userId?: string;
};

interface GroupedEntry {
    offset: number;
    durationMs: number;
    tail: number;
    entry: InfoChartRow;
}

function formatClock(value: number, hour12: boolean, includeSeconds = false) {
    return formatAppClock(value, { hour12, includeSeconds });
}

function truncateLabel(value: unknown, maxLength = 20) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function markerForEntry(entry: InfoChartTooltipRow) {
    if (entry?.isFavorite) {
        return '\u2606';
    }
    if (entry?.isFriend) {
        return '\u2661';
    }
    return '';
}

function richMarkerForEntry(entry: InfoChartTooltipRow) {
    if (entry?.isFavorite) {
        return '{favorite|\u2606}';
    }
    if (entry?.isFriend) {
        return '{friend|\u2661}';
    }
    return '{empty| }';
}

function isValidInterval(row: InfoChartRow) {
    return (
        Number.isFinite(row.joinMs) &&
        Number.isFinite(row.leaveMs) &&
        row.leaveMs > row.joinMs &&
        row.durationMs > 0
    );
}

function overlapsWindow(
    row: InfoChartRow,
    window: PreviousInstanceVisitWindow,
    toleranceMs = 0
) {
    return (
        row.joinMs <= window.endMs + toleranceMs &&
        row.leaveMs >= window.startMs
    );
}

function clipRowToWindow(
    row: InfoChartRow,
    window: PreviousInstanceVisitWindow
): InfoChartRow | null {
    const joinMs = Math.max(row.joinMs, window.startMs);
    const leaveMs = Math.min(row.leaveMs, window.endMs);
    if (leaveMs <= joinMs) {
        return null;
    }
    return {
        ...row,
        joinMs,
        leaveMs,
        durationMs: leaveMs - joinMs
    };
}

export function buildInfoTimelineRows({
    rows,
    visitWindow
}: {
    rows: InfoChartRow[];
    visitWindow: PreviousInstanceVisitWindow | null;
}): InfoChartRow[] {
    if (!visitWindow) {
        return [];
    }

    const validRows = rows.filter(isValidInterval);
    const selfRows = validRows.filter(
        (row) =>
            row.isSelf &&
            overlapsWindow(row, visitWindow, VISIT_BOUNDARY_TOLERANCE_MS)
    );
    if (!selfRows.length) {
        return [];
    }

    const peerRows = validRows
        .filter((row) => !row.isSelf)
        .flatMap((row) =>
            selfRows
                .map((selfRow) =>
                    clipRowToWindow(row, {
                        startMs: selfRow.joinMs,
                        endMs: selfRow.leaveMs
                    })
                )
                .filter((entry): entry is InfoChartRow => entry !== null)
        );

    return [...selfRows, ...peerRows];
}

export function buildInfoChartTooltipParts(
    detailEntry: InfoChartTooltipRow,
    hour12: boolean
) {
    return {
        title: `${markerForEntry(detailEntry)} ${detailEntry.displayName || ''}`.trim(),
        timeRange: `${formatClock(detailEntry.joinMs, hour12, true)} - ${formatClock(detailEntry.leaveMs, hour12, true)}`,
        duration: timeToText(detailEntry.durationMs, true)
    };
}

export function buildInfoChartOption({
    rows,
    hour12,
    tooltipFormatter = null
}: {
    rows: InfoChartRow[];
    hour12: boolean;
    tooltipFormatter?:
        | ((entry: InfoChartRow, hour12: boolean) => string | HTMLElement)
        | null;
}) {
    if (!rows.length) {
        return null;
    }

    const startMs = Math.min(...rows.map((entry) => entry.joinMs));
    const endMs = Math.max(...rows.map((entry) => entry.leaveMs));
    if (
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs
    ) {
        return null;
    }

    const groupedByUser = new Map<string, GroupedEntry[]>();
    const firstEntries: InfoChartRow[] = [];
    const sortedRows = [...rows].sort((left, right) => {
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
        ...Array.from(groupedByUser.values()).map((entries) => entries.length)
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
            data: firstEntries.map((entry) => {
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
            data: firstEntries.map((entry) => {
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
                formatter(params: { seriesIndex: number; dataIndex: number }) {
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
                    rich: {
                        favorite: {
                            color: '#fbbf24',
                            align: 'center',
                            width: 14
                        },
                        friend: {
                            color: '#fda4af',
                            align: 'center',
                            width: 14
                        },
                        empty: {
                            width: 14
                        }
                    },
                    formatter(value: unknown, index: number) {
                        const entry = firstEntries[index];
                        return `${richMarkerForEntry(entry)} ${truncateLabel(value, 20)}`;
                    }
                },
                data: firstEntries.map((entry) => entry.displayName)
            },
            xAxis: {
                type: 'value',
                min: 0,
                max: endMs - startMs,
                axisLine: { show: true },
                axisLabel: {
                    formatter(value: number) {
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
