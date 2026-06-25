import { formatClock as formatAppClock, timeToText } from '@/lib/dateTime';

import { getLocalDayBounds } from './instanceActivityRows';
import type {
    InstanceActivityChartRow,
    InstanceActivityDetailGroup,
    InstanceActivityDetailRow,
    TranslateKey
} from './instanceActivityTypes';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const THREE_HOURS_MS = 3 * HOUR_MS;
const AXIS_PADDING_MS = 30 * 60 * 1000;

function pickAxisInterval(spanMs: number) {
    const candidates = [
        30 * 60 * 1000,
        HOUR_MS,
        2 * HOUR_MS,
        THREE_HOURS_MS,
        6 * HOUR_MS
    ];
    for (const candidate of candidates) {
        if (spanMs / candidate <= 8) {
            return candidate;
        }
    }
    return THREE_HOURS_MS;
}

export type ChartEventParams = {
    componentType?: string;
    seriesName?: string;
    dataIndex?: number;
    seriesIndex?: number;
};

type ChartDataItem =
    | number
    | {
          value: number;
          itemStyle: {
              borderColor: string;
              borderWidth: number;
              shadowBlur: number;
          };
      };

function getActivityAxisWindow(
    rows: InstanceActivityChartRow[],
    dayStartMs: number
) {
    const fullDay = {
        originMs: dayStartMs,
        spanMs: DAY_MS,
        interval: THREE_HOURS_MS
    };
    if (!rows.length) {
        return fullDay;
    }
    let first = Infinity;
    let last = -Infinity;
    for (const row of rows) {
        const start = row.visibleStartMs;
        const end = row.visibleStartMs + row.visibleDurationMs;
        if (start < first) {
            first = start;
        }
        if (end > last) {
            last = end;
        }
    }
    if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
        return fullDay;
    }
    const dayEndMs = dayStartMs + DAY_MS;
    let origin = Math.floor((first - AXIS_PADDING_MS) / HOUR_MS) * HOUR_MS;
    let end = Math.ceil((last + AXIS_PADDING_MS) / HOUR_MS) * HOUR_MS;
    origin = Math.max(origin, dayStartMs);
    end = Math.min(end, dayEndMs);
    if (end - origin < HOUR_MS) {
        end = Math.min(origin + HOUR_MS, dayEndMs);
        origin = Math.max(end - HOUR_MS, dayStartMs);
    }
    const spanMs = end - origin;
    return { originMs: origin, spanMs, interval: pickAxisInterval(spanMs) };
}

export function formatClock(
    value: Date | number | string,
    hour12: boolean,
    includeSeconds = false
) {
    return formatAppClock(value, { hour12, includeSeconds });
}

export function truncateLabel(value: unknown, maxLength = 26): string {
    const text = String(value || '');
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function worldNameLabel(
    row: InstanceActivityChartRow,
    t: TranslateKey
): string {
    return row?.worldName || t('dashboard.widget.unknown_world');
}

export function buildChartOption({
    rows,
    selectedDate,
    barWidth,
    hour12,
    selectedActivityKey = '',
    t
}: {
    rows: InstanceActivityChartRow[];
    selectedDate: string;
    barWidth: number;
    hour12: boolean;
    selectedActivityKey?: string;
    t: TranslateKey;
}) {
    const { startMs } = getLocalDayBounds(selectedDate);
    const axis = getActivityAxisWindow(rows, startMs);

    return {
        animationDuration: 250,
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'shadow'
            },
            formatter(params: ChartEventParams | ChartEventParams[]) {
                const target = Array.isArray(params)
                    ? params.find((item) => item.seriesName === 'Time') ||
                      params[0]
                    : params;
                const row =
                    typeof target?.dataIndex === 'number'
                        ? rows[target.dataIndex]
                        : null;
                if (!row) {
                    return '';
                }

                const locationBits = [];
                if (row.parsedLocation.instanceName) {
                    locationBits.push(`#${row.parsedLocation.instanceName}`);
                }
                if (row.parsedLocation.accessTypeName) {
                    locationBits.push(row.parsedLocation.accessTypeName);
                }

                return [
                    `<div class="min-w-44">`,
                    `<div style="font-weight:600;margin-bottom:4px;">${worldNameLabel(row, t)}</div>`,
                    locationBits.length
                        ? `<div style="margin-bottom:4px;">${locationBits.join(' ')}</div>`
                        : '',
                    `<div>${formatClock(row.joinMs, hour12, true)} - ${formatClock(row.leaveMs, hour12, true)}</div>`,
                    `<div>${t('view.charts.instance_activity.online_time')}: ${timeToText(row.visibleDurationMs, true)}</div>`,
                    `</div>`
                ].join('');
            }
        },
        grid: {
            top: 24,
            left: 170,
            right: 84,
            bottom: 24
        },
        yAxis: {
            type: 'category',
            inverse: true,
            triggerEvent: true,
            axisTick: { show: false },
            axisLabel: {
                interval: 0,
                formatter(value: unknown) {
                    return truncateLabel(value);
                }
            },
            data: rows.map((row) => worldNameLabel(row, t))
        },
        xAxis: {
            type: 'value',
            min: 0,
            max: axis.spanMs,
            interval: axis.interval,
            axisLabel: {
                formatter(value: number) {
                    return formatClock(axis.originMs + value, hour12, false);
                }
            },
            splitLine: {
                lineStyle: {
                    type: 'dashed'
                }
            }
        },
        series: [
            {
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
                data: rows.map((row) =>
                    Math.max(0, row.visibleStartMs - axis.originMs)
                )
            },
            {
                name: 'Time',
                type: 'bar',
                stack: 'Total',
                colorBy: 'data',
                barWidth,
                itemStyle: {
                    borderRadius: 3,
                    shadowBlur: 2,
                    shadowOffsetX: 0.7,
                    shadowOffsetY: 0.5
                },
                data: rows.map((row): ChartDataItem => {
                    if (
                        !selectedActivityKey ||
                        row.activityKey !== selectedActivityKey
                    ) {
                        return row.visibleDurationMs;
                    }
                    return {
                        value: row.visibleDurationMs,
                        itemStyle: {
                            borderColor: '#facc15',
                            borderWidth: 2,
                            shadowBlur: 5
                        }
                    };
                })
            }
        ],
        backgroundColor: 'transparent'
    };
}

export function getMainChartClickedRow(
    params: ChartEventParams,
    rows: InstanceActivityChartRow[] = []
): InstanceActivityChartRow | null {
    const row =
        typeof params?.dataIndex === 'number' ? rows[params.dataIndex] : null;
    if (params?.componentType === 'yAxis') {
        return row || null;
    }
    if (params?.componentType === 'series' && params?.seriesName === 'Time') {
        return row || null;
    }
    return null;
}

export function buildDetailChartOption({
    group,
    barWidth,
    hour12
}: {
    group: InstanceActivityDetailGroup;
    barWidth: number;
    hour12: boolean;
}) {
    const currentUserEntry = group.find((entry) => entry.isCurrentUser);
    const startMs =
        currentUserEntry?.joinMs ??
        Math.min(...group.map((entry) => entry.joinMs));
    const endMs =
        currentUserEntry?.leaveMs ??
        Math.max(...group.map((entry) => entry.leaveMs));
    if (
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs
    ) {
        return null;
    }

    const groupedByUser = new Map<string, InstanceActivityDetailRow[]>();
    const firstEntries: InstanceActivityDetailRow[] = [];
    for (const entry of group) {
        let userEntries = groupedByUser.get(entry.userId);
        if (!userEntries) {
            userEntries = [];
            groupedByUser.set(entry.userId, userEntries);
            firstEntries.push(entry);
        }
        userEntries.push(entry);
    }

    for (const entries of groupedByUser.values()) {
        entries.sort((left, right) => left.joinMs - right.joinMs);
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
                const rows = groupedByUser.get(entry.userId) || [];
                const row = rows[entryIndex];
                if (!row) {
                    return 0;
                }
                const previous = rows[entryIndex - 1];
                return Math.max(
                    0,
                    row.joinMs - (previous ? previous.leaveMs : startMs)
                );
            })
        });
        series.push({
            name: 'Time',
            type: 'bar',
            stack: 'Total',
            colorBy: 'data',
            barWidth,
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
                const row = (groupedByUser.get(entry.userId) || [])[entryIndex];
                return row ? row.durationMs : 0;
            })
        });
    }

    function friendMarker(entry: InstanceActivityDetailRow) {
        if (entry.isFavorite) {
            return '\u2b50 ';
        }
        if (entry.isFriend) {
            return '\ud83d\udc9a ';
        }
        return '';
    }

    return {
        animationDuration: 200,
        tooltip: {
            trigger: 'item',
            formatter(params: ChartEventParams) {
                if (
                    params.seriesIndex == null ||
                    params.dataIndex == null ||
                    params.seriesIndex % 2 === 0
                ) {
                    return '';
                }

                const userEntry = firstEntries[params.dataIndex];
                const entry = (groupedByUser.get(userEntry?.userId) || [])[
                    Math.floor(params.seriesIndex / 2)
                ];
                if (!entry) {
                    return '';
                }

                return [
                    `<div class="min-w-44">`,
                    `<div style="font-weight:600;margin-bottom:4px;">${entry.displayName} ${friendMarker(entry).trim()}</div>`,
                    `<div>${formatClock(entry.joinMs, hour12, true)} - ${formatClock(entry.leaveMs, hour12, true)}</div>`,
                    `<div>${timeToText(entry.durationMs, true)}</div>`,
                    `</div>`
                ].join('');
            }
        },
        grid: {
            top: 24,
            left: 170,
            right: 84,
            bottom: 24
        },
        yAxis: {
            type: 'category',
            inverse: true,
            triggerEvent: true,
            axisLabel: {
                interval: 0,
                formatter(value: unknown) {
                    return truncateLabel(value, 24);
                }
            },
            data: firstEntries.map(
                (entry) => `${friendMarker(entry)}${entry.displayName}`
            )
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
        backgroundColor: 'transparent',
        firstEntries
    };
}
