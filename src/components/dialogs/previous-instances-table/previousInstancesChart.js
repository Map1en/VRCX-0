import { timeToText } from '@/lib/dateTime.js';

export const INFO_CHART_BAR_WIDTH = 12;

function formatClock(value, hour12, includeSeconds = false) {
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

function truncateLabel(value, maxLength = 20) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function markerForEntry(entry) {
    if (entry?.isFavorite) {
        return '* ';
    }
    if (entry?.isFriend) {
        return '+ ';
    }
    return '';
}

export function buildInfoChartTooltipParts(detailEntry, hour12) {
    return {
        title: `${detailEntry.displayName || ''} ${markerForEntry(detailEntry).trim()}`.trim(),
        timeRange: `${formatClock(detailEntry.joinMs, hour12, true)} - ${formatClock(detailEntry.leaveMs, hour12, true)}`,
        duration: timeToText(detailEntry.durationMs, true)
    };
}

export function buildInfoChartOption({ rows, hour12, tooltipFormatter = null }) {
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

    const groupedByUser = new Map();
    const firstEntries = [];
    const sortedRows = [...rows].sort((left, right) => {
        const joinDiff = Math.abs(left.joinMs - right.joinMs);
        return joinDiff < 3000
            ? left.leaveMs - right.leaveMs
            : left.joinMs - right.joinMs;
    });

    for (const entry of sortedRows) {
        if (!groupedByUser.has(entry.userId)) {
            groupedByUser.set(entry.userId, []);
            firstEntries.push(entry);
        }
        const entries = groupedByUser.get(entry.userId);
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
                formatter(params) {
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
                    const parts = buildInfoChartTooltipParts(detailEntry, hour12);
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
                    formatter(value, index) {
                        const entry = firstEntries[index];
                        return `${markerForEntry(entry)}${truncateLabel(value, 20)}`;
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
            backgroundColor: 'transparent'
        },
        firstEntries
    };
}
