import { timeToText } from '@/lib/dateTime.js';

import { getLocalDayBounds } from './instanceActivityRows.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export function formatClock(value, hour12, includeSeconds = false) {
    try {
        return new Intl.DateTimeFormat(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: includeSeconds ? '2-digit' : undefined,
            hour12
        }).format(new Date(value));
    } catch {
        return '';
    }
}

export function truncateLabel(value, maxLength = 26) {
    const text = String(value || '');
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function worldNameLabel(row, t) {
    return row?.worldName || t('dashboard.widget.unknown_world');
}

export function buildChartOption({ rows, selectedDate, barWidth, hour12, t }) {
    const { startMs } = getLocalDayBounds(selectedDate);

    return {
        animationDuration: 250,
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'shadow'
            },
            formatter(params) {
                const target = Array.isArray(params)
                    ? params.find((item) => item.seriesName === 'Time') ||
                      params[0]
                    : params;
                const row = rows[target?.dataIndex];
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
                formatter(value) {
                    return truncateLabel(value);
                }
            },
            data: rows.map((row) => worldNameLabel(row, t))
        },
        xAxis: {
            type: 'value',
            min: 0,
            max: DAY_MS,
            interval: THREE_HOURS_MS,
            axisLabel: {
                formatter(value) {
                    return formatClock(startMs + value, hour12, false);
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
                    Math.max(0, row.visibleStartMs - startMs)
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
                data: rows.map((row) => row.visibleDurationMs)
            }
        ],
        backgroundColor: 'transparent'
    };
}

export function buildDetailChartOption({ group, barWidth, hour12 }) {
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

    const groupedByUser = new Map();
    const firstEntries = [];
    for (const entry of group) {
        if (!groupedByUser.has(entry.userId)) {
            groupedByUser.set(entry.userId, []);
            firstEntries.push(entry);
        }
        groupedByUser.get(entry.userId).push(entry);
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

    function friendMarker(entry) {
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
            formatter(params) {
                if (params.seriesIndex % 2 === 0) {
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
                formatter(value) {
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
                formatter(value) {
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
