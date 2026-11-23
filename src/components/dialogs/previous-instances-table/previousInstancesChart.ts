import { format } from 'echarts/core';

import { formatClock as formatAppClock, timeToText } from '@/lib/dateTime';

import type { PreviousInstanceVisitWindow } from './previousInstancesRows';

export const INFO_CHART_BAR_WIDTH = 12;
export const INFO_CHART_GRID = { top: 50, left: 160, right: 90, bottom: 24 };
const SECONDS_AXIS_MAX_SPAN_MS = 30 * 60 * 1000;

export function infoChartHeight(rowCount: number, topInset: number) {
    return Math.max(
        220,
        rowCount * (INFO_CHART_BAR_WIDTH + 10) + 200 + topInset
    );
}

export function infoChartFirstBarTop(rowCount: number, topInset: number) {
    const gridTop = INFO_CHART_GRID.top + topInset;
    const bandHeight =
        (infoChartHeight(rowCount, topInset) -
            gridTop -
            INFO_CHART_GRID.bottom) /
        Math.max(1, rowCount);
    return gridTop + bandHeight / 2 - INFO_CHART_BAR_WIDTH / 2;
}

export type InfoChartPalette = {
    axisLabel: string;
    splitLine: string;
};

export const INFO_CHART_PALETTES: Record<'dark' | 'light', InfoChartPalette> = {
    dark: {
        axisLabel: '#a1a1a1',
        splitLine: 'rgba(255, 255, 255, 0.06)'
    },
    light: {
        axisLabel: '#737373',
        splitLine: 'rgba(0, 0, 0, 0.06)'
    }
};
const AVATAR_LANE_COLORS = [
    '#7c9cf5',
    '#f0a868',
    '#6cc4a4',
    '#e88aa8',
    '#a78bfa',
    '#d4c25a'
];
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
    palette = INFO_CHART_PALETTES.dark,
    topInset = 0,
    tooltipFormatter = null
}: {
    rows: InfoChartRow[];
    hour12: boolean;
    topInset?: number;
    palette?: InfoChartPalette;
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
            barMinHeight: INFO_CHART_BAR_WIDTH,
            emphasis: {
                focus: 'self'
            },
            itemStyle: {
                borderRadius: 3
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
                        .map((part) => format.encodeHTML(part))
                        .join('<br />');
                }
            },
            grid: { ...INFO_CHART_GRID, top: INFO_CHART_GRID.top + topInset },
            yAxis: {
                type: 'category',
                inverse: true,
                triggerEvent: true,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: {
                    interval: 0,
                    color: palette.axisLabel,
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
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: {
                    color: palette.axisLabel,
                    hideOverlap: true,
                    formatter(value: number) {
                        return formatClock(
                            startMs + value,
                            hour12,
                            endMs - startMs <= SECONDS_AXIS_MAX_SPAN_MS
                        );
                    }
                },
                splitLine: {
                    lineStyle: {
                        type: 'solid',
                        color: palette.splitLine
                    }
                }
            },
            series,
            backgroundColor: 'transparent'
        },
        firstEntries,
        startMs,
        endMs
    };
}

export function buildAvatarLaneSegments<
    T extends { avatarId: string; startedAtMs: number; endedAtMs: number }
>(segments: readonly T[], startMs: number, endMs: number) {
    const spanMs = endMs - startMs;
    if (spanMs <= 0) {
        return [];
    }
    const colors = new Map<string, string>();
    const inRange = segments.filter(
        (segment) => segment.endedAtMs > startMs && segment.startedAtMs < endMs
    );
    return inRange.map((segment, index) => {
        const fromMs =
            index === 0 ? startMs : Math.max(segment.startedAtMs, startMs);
        const toMs =
            index === inRange.length - 1
                ? endMs
                : Math.min(segment.endedAtMs, endMs);
        let color = colors.get(segment.avatarId);
        if (!color) {
            color = AVATAR_LANE_COLORS[colors.size % AVATAR_LANE_COLORS.length];
            colors.set(segment.avatarId, color);
        }
        return {
            segment,
            fromMs,
            toMs,
            color,
            leftPercent: ((fromMs - startMs) / spanMs) * 100,
            widthPercent: ((toMs - fromMs) / spanMs) * 100
        };
    });
}
