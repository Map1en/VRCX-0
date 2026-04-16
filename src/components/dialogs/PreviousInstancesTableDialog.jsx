import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from 'lucide-react';
import * as echarts from 'echarts';
import { toast } from 'sonner';

import { Location } from '@/components/Location.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar.jsx';
import { timeToText } from '@/lib/dateTime.js';
import { userProfileRepository } from '@/repositories/index.js';
import { database } from '@/services/database/index.js';
import { openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { getResolvedThemeMode } from '@/services/themeService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

const INFO_CHART_BAR_WIDTH = 12;

function formatDate(value) {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

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

function createdTime(row) {
    return new Date(row?.created_at || row?.createdAt || 0).getTime() || 0;
}

function rowLocation(row) {
    return row?.$location?.tag || row?.location || row?.worldId || row?.id || '';
}

function rowWorldId(row) {
    const location = rowLocation(row);
    return parseLocation(location).worldId || '';
}

function rowLocationObject(row) {
    const location = rowLocation(row);
    const ownerUserId = rowOwnerUserId(row);
    const baseLocation = {
        ...parseLocation(location),
        tag: location,
        location,
        worldName: row?.worldName || row?.$location?.worldName || '',
        groupName: row?.groupName || row?.$location?.groupName || '',
        ownerUserId,
        userId: ownerUserId,
        ownerDisplayName: row?.ownerDisplayName || row?.ownerName || row?.$location?.ownerDisplayName || ''
    };
    if (row?.$location && typeof row.$location === 'object') {
        return {
            ...baseLocation,
            ...row.$location,
            tag: row.$location.tag || location,
            location: row.$location.tag || location,
            ownerUserId: row.$location.ownerUserId || row.$location.owner_user_id || row.$location.userId || ownerUserId,
            userId: row.$location.userId || row.$location.user_id || row.$location.ownerUserId || ownerUserId
        };
    }
    return baseLocation;
}

function rowOwnerUserId(row) {
    return row?.$location?.userId ||
        row?.$location?.user_id ||
        row?.$location?.ownerUserId ||
        row?.$location?.owner_user_id ||
        row?.ownerUserId ||
        row?.owner_user_id ||
        row?.ownerId ||
        row?.owner_id ||
        row?.userId ||
        row?.user_id ||
        '';
}

function rowDuration(row) {
    const value = Number(row?.time || row?.duration || 0);
    return Number.isFinite(value) && value > 0 ? timeToText(value) : '—';
}

function rowSearchText(row) {
    return [
        row?.created_at,
        row?.createdAt,
        row?.location,
        row?.$location?.tag,
        row?.worldId,
        row?.worldName,
        row?.groupName
    ].filter(Boolean).join(' ').toLowerCase();
}

function normalizePlayerRows(players) {
    const rows = players instanceof Map
        ? Array.from(players.values())
        : Array.isArray(players)
            ? players
            : [];
    return rows.sort((left, right) => Number(right?.time || 0) - Number(left?.time || 0));
}

function playerDisplayName(row) {
    return row?.displayName || row?.display_name || '—';
}

function playerUserId(row) {
    return row?.userId || row?.user_id || '';
}

function InstanceOwnerCell({ userId, location = '', endpoint = '' }) {
    const [displayName, setDisplayName] = useState(userId || '');

    useEffect(() => {
        let active = true;
        if (!userId) {
            setDisplayName('');
            return () => {
                active = false;
            };
        }

        setDisplayName(userId);
        userProfileRepository
            .getUserProfile({ userId, endpoint })
            .then((profile) => {
                if (!active) {
                    return;
                }
                setDisplayName(profile?.displayName || profile?.username || profile?.name || userId);
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [endpoint, userId]);

    if (!userId) {
        return <span className="text-muted-foreground">—</span>;
    }

    return (
        <Button
            type="button"
            variant="link"
            className="h-auto max-w-full flex-col items-start justify-start gap-0 p-0 text-left text-xs"
            title={[displayName || userId, userId, location].filter(Boolean).join('\n')}
            onClick={() => openUserDialog({ userId, title: displayName || undefined })}>
            <span className="truncate">{displayName || userId}</span>
            {displayName && displayName !== userId ? (
                <span className="max-w-full truncate text-xs text-muted-foreground">{userId}</span>
            ) : null}
        </Button>
    );
}

function normalizeInfoChartRows(rows, currentUserId, friendsById, favoriteIdSet) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => {
            const durationMs = Math.max(0, Number(row?.time || 0));
            const leaveMs = new Date(row?.created_at || row?.createdAt || 0).getTime();
            const userId = playerUserId(row);
            if (!Number.isFinite(leaveMs) || !userId) {
                return null;
            }
            return {
                ...row,
                userId,
                displayName: playerDisplayName(row),
                joinMs: leaveMs - durationMs,
                leaveMs,
                durationMs,
                isFriend: userId === currentUserId ? null : Boolean(friendsById?.[userId]),
                isFavorite: userId === currentUserId ? null : favoriteIdSet.has(userId)
            };
        })
        .filter(Boolean);
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

function createInfoChartTooltipElement(detailEntry, hour12) {
    const container = document.createElement('div');
    container.className = 'min-w-44';

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '4px';
    title.textContent = `${detailEntry.displayName || ''} ${markerForEntry(detailEntry).trim()}`.trim();
    container.appendChild(title);

    const timeRange = document.createElement('div');
    timeRange.textContent = `${formatClock(detailEntry.joinMs, hour12, true)} - ${formatClock(detailEntry.leaveMs, hour12, true)}`;
    container.appendChild(timeRange);

    const duration = document.createElement('div');
    duration.textContent = timeToText(detailEntry.durationMs, true);
    container.appendChild(duration);

    return container;
}

function buildInfoChartOption({ rows, hour12 }) {
    if (!rows.length) {
        return null;
    }

    const startMs = Math.min(...rows.map((entry) => entry.joinMs));
    const endMs = Math.max(...rows.map((entry) => entry.leaveMs));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
    }

    const groupedByUser = new Map();
    const firstEntries = [];
    const sortedRows = [...rows].sort((left, right) => {
        const joinDiff = Math.abs(left.joinMs - right.joinMs);
        return joinDiff < 3000 ? left.leaveMs - right.leaveMs : left.joinMs - right.joinMs;
    });

    for (const entry of sortedRows) {
        if (!groupedByUser.has(entry.userId)) {
            groupedByUser.set(entry.userId, []);
            firstEntries.push(entry);
        }
        const entries = groupedByUser.get(entry.userId);
        const previous = entries[entries.length - 1];
        const offset = Math.max(0, previous ? entry.joinMs - startMs - previous.tail : entry.joinMs - startMs);
        const tail = previous ? previous.tail + offset + entry.durationMs : offset + entry.durationMs;
        entries.push({
            offset,
            durationMs: entry.durationMs,
            tail,
            entry
        });
    }

    const maxEntryCount = Math.max(...Array.from(groupedByUser.values()).map((entries) => entries.length));
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
                    const detailEntry = groupedByUser.get(userEntry?.userId)?.[Math.floor(params.seriesIndex / 2)]?.entry;
                    if (!detailEntry) {
                        return '';
                    }
                    return createInfoChartTooltipElement(detailEntry, hour12);
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
                    formatter(value) {
                        const entry = firstEntries.find((item) => item.displayName === value);
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

function PreviousInstanceInfoChart({ rows }) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const favoriteFriendIds = useFavoriteStore((state) => state.favoriteFriendIds);
    const localFriendFavoritesList = useFavoriteStore((state) => state.localFriendFavoritesList);
    const shellThemeMode = useShellStore((state) => state.themeMode);
    const resolvedTheme = getResolvedThemeMode(shellThemeMode);
    const hour12 = usePreferencesStore((state) => state.dtHour12);

    const [chartElement, setChartElement] = useState(null);
    const chartElementRef = useRef(null);
    const chartInstanceRef = useRef(null);
    const chartThemeRef = useRef(null);
    const resizeObserverRef = useRef(null);

    const favoriteIdSet = useMemo(
        () => new Set([...(favoriteFriendIds || []), ...(localFriendFavoritesList || [])].filter(Boolean)),
        [favoriteFriendIds, localFriendFavoritesList]
    );
    const chartRows = useMemo(
        () => normalizeInfoChartRows(rows, currentUserId, friendsById, favoriteIdSet),
        [currentUserId, favoriteIdSet, friendsById, rows]
    );
    const chartPayload = useMemo(
        () => buildInfoChartOption({ rows: chartRows, hour12 }),
        [chartRows, hour12]
    );

    const setInfoChartElementRef = useCallback((node) => {
        if (chartElementRef.current && chartElementRef.current !== node) {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
            chartThemeRef.current = null;
        }
        chartElementRef.current = node;
        setChartElement(node);
    }, []);

    useEffect(() => () => {
        resizeObserverRef.current?.disconnect();
        chartInstanceRef.current?.dispose();
        resizeObserverRef.current = null;
        chartInstanceRef.current = null;
        chartThemeRef.current = null;
    }, []);

    useEffect(() => {
        if (!chartElement) {
            return;
        }

        const themeName = resolvedTheme === 'dark' ? 'dark' : null;
        let chart = chartInstanceRef.current;

        if (!chart || chartThemeRef.current !== themeName) {
            resizeObserverRef.current?.disconnect();
            chart?.dispose();

            chart = echarts.init(chartElement, themeName || undefined, {
                useDirtyRect: chartRows.length > 80
            });
            chartInstanceRef.current = chart;
            chartThemeRef.current = themeName;

            resizeObserverRef.current = new ResizeObserver(() => {
                chart.resize();
            });
            resizeObserverRef.current.observe(chartElement);
        }

        const chartRowCount = chartPayload?.firstEntries.length || chartRows.length;
        const chartHeight = Math.max(220, chartRowCount * (INFO_CHART_BAR_WIDTH + 10) + 200);
        chartElement.style.height = `${chartHeight}px`;
        chart.resize({ height: chartHeight });
        chart.off('click');

        if (!chartPayload) {
            chart.clear();
            return;
        }

        chart.clear();
        chart.setOption(chartPayload.option, { notMerge: true });
        chart.on('click', (params) => {
            if (params.componentType !== 'yAxis') {
                return;
            }
            const entry = chartPayload.firstEntries[params.dataIndex];
            if (entry?.userId) {
                openUserDialog({ userId: entry.userId, title: entry.displayName || undefined });
            }
        });
    }, [chartElement, chartPayload, chartRows.length, resolvedTheme]);

    if (!chartRows.length) {
        return (
            <div className="flex min-h-52 items-center justify-center rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                No player detail rows for this instance.
            </div>
        );
    }

    return <div ref={setInfoChartElementRef} className="w-full bg-transparent" />;
}

function PreviousInstancesTableDialog({
    open,
    onOpenChange,
    title = 'Previous Instances',
    instances = [],
    variant = 'world',
    targetRef = null,
    onRowsChange = null,
    autoOpenInfo = false
}) {
    const confirm = useModalStore((state) => state.confirm);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const [rows, setRows] = useState([]);
    const [search, setSearch] = useState('');
    const [sortDesc, setSortDesc] = useState(true);
    const [pageSize, setPageSize] = useState(10);
    const [pageIndex, setPageIndex] = useState(0);
    const [infoRow, setInfoRow] = useState(null);
    const [infoViewMode, setInfoViewMode] = useState('table');
    const [infoData, setInfoData] = useState({
        status: 'idle',
        error: '',
        players: [],
        details: []
    });

    useEffect(() => {
        if (open) {
            setRows(Array.isArray(instances) ? instances : []);
            setPageIndex(0);
            if (autoOpenInfo && Array.isArray(instances) && instances.length > 0) {
                setInfoRow(instances[0]);
            }
        } else {
            setInfoRow(null);
            setInfoViewMode('table');
        }
    }, [autoOpenInfo, instances, open]);

    useEffect(() => {
        if (!infoRow) {
            setInfoData({ status: 'idle', error: '', players: [], details: [] });
            return undefined;
        }

        const location = rowLocation(infoRow);
        if (!location) {
            setInfoData({ status: 'ready', error: '', players: [], details: [] });
            return undefined;
        }

        let active = true;
        setInfoData({ status: 'running', error: '', players: [], details: [] });

        Promise.all([
            database.getPlayersFromInstance(location),
            database.getPlayerDetailFromInstance(location)
        ])
            .then(([players, details]) => {
                if (!active) {
                    return;
                }
                setInfoData({
                    status: 'ready',
                    error: '',
                    players: normalizePlayerRows(players),
                    details: Array.isArray(details) ? details : []
                });
            })
            .catch((error) => {
                if (!active) {
                    return;
                }
                setInfoData({
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Failed to load instance details.',
                    players: [],
                    details: []
                });
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, infoRow]);

    const filteredRows = useMemo(() => {
        const query = search.trim().toLowerCase();
        const nextRows = query
            ? rows.filter((row) => rowSearchText(row).includes(query))
            : rows;
        return [...nextRows].sort((left, right) =>
            sortDesc ? createdTime(right) - createdTime(left) : createdTime(left) - createdTime(right)
        );
    }, [rows, search, sortDesc]);

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPageIndex = Math.min(pageIndex, totalPages - 1);
    const visibleRows = filteredRows.slice(currentPageIndex * pageSize, currentPageIndex * pageSize + pageSize);

    async function deleteRow(row) {
        const location = rowLocation(row);
        if (!location) {
            return;
        }
        const result = await confirm({
            title: 'Delete previous instance?',
            description: location,
            destructive: true,
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        try {
            if (variant === 'user') {
                if (!Array.isArray(row.events) || row.events.length === 0) {
                    toast.error('This user instance row cannot be deleted without event ids.');
                    return;
                }
                await database.deleteGameLogInstance({
                    id: targetRef?.id || '',
                    location,
                    events: row.events
                });
            } else {
                await database.deleteGameLogInstanceByInstanceId({ location });
            }
            setRows((current) => {
                const nextRows = current.filter((item) => item !== row);
                onRowsChange?.(nextRows);
                return nextRows;
            });
            setInfoRow((current) => (current === row ? null : current));
            toast.success('Previous instance deleted.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete previous instance.');
        }
    }

    function openLocation(row) {
        const worldId = rowWorldId(row);
        if (!worldId) {
            return;
        }
        openWorldDialog({ worldId, title: row?.worldName || undefined });
        onOpenChange?.(false);
    }

    function openInfo(row) {
        setInfoRow(row);
        setInfoViewMode('table');
    }

    function renderLocationCell(row) {
        const location = rowLocation(row);
        if (variant === 'world') {
            const locationObject = rowLocationObject(row);
            return (
                <LocationWorld
                    locationObject={locationObject}
                    grouphint={row?.groupName}
                    currentUserId={currentUserId}
                    worldDialogShortName={locationObject.shortName || ''}
                    instanceOwner={locationObject.ownerUserId || locationObject.userId || ''}
                    instanceOwnerName={locationObject.ownerDisplayName || row?.ownerDisplayName || row?.ownerName || ''}
                    interactive={false}
                    hint={row?.worldName || ''}
                    className="max-w-full"
                />
            );
        }
        return (
            <Location
                location={location}
                hint={row?.worldName || ''}
                link={false}
                disableTooltip
                asButton={false}
            />
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] max-w-[min(92vw,72rem)] flex-col">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{filteredRows.length}/{rows.length} recorded instance visits.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Input
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value);
                            setPageIndex(0);
                        }}
                        placeholder="Search previous instances"
                        className="max-w-sm"
                    />
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Rows</span>
                        <Select
                            value={String(pageSize)}
                            onValueChange={(value) => {
                                setPageSize(Number.parseInt(value, 10) || 10);
                                setPageIndex(0);
                            }}>
                            <SelectTrigger size="sm" className="w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {[10, 25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                    <table className="w-full text-left text-sm">
                            <thead className="sticky top-0 bg-background">
                                <tr className="border-b">
                                    <th className="w-44 px-3 py-2">
                                        <Button type="button" variant="ghost" size="sm" className="h-auto px-1" onClick={() => setSortDesc((value) => !value)}>
                                            Created
                                            {sortDesc ? <ArrowDownIcon data-icon="inline-end" /> : <ArrowUpIcon data-icon="inline-end" />}
                                        </Button>
                                    </th>
                                    <th className="px-3 py-2">Location</th>
                                    <th className="w-48 px-3 py-2">World / Group</th>
                                    <th className="w-44 px-3 py-2">Creator</th>
                                    <th className="w-24 px-3 py-2">Duration</th>
                                    <th className="w-80 px-3 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleRows.length ? visibleRows.map((row, index) => {
                                    const location = rowLocation(row);
                                    return (
                                        <tr key={`${location}:${row?.id || row?.created_at || row?.createdAt || index}`} className="border-b last:border-b-0">
                                            <td className="px-3 py-2 align-top text-xs text-muted-foreground">{formatDate(row?.created_at || row?.createdAt)}</td>
                                            <td className="relative max-w-[26rem] px-3 py-2 align-top text-xs">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="absolute inset-0 h-full w-full rounded-none p-0 hover:bg-muted"
                                                    onClick={() => openInfo(row)}>
                                                    <span className="sr-only">Open instance details</span>
                                                </Button>
                                                <div className="pointer-events-none relative z-10 max-w-full text-left">
                                                    {location ? renderLocationCell(row) : '—'}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                                                {[row?.worldName, row?.groupName].filter(Boolean).join(' / ') || '—'}
                                            </td>
                                            <td className="px-3 py-2 align-top">
                                                <InstanceOwnerCell userId={rowOwnerUserId(row)} location={location} endpoint={currentEndpoint} />
                                            </td>
                                            <td className="px-3 py-2 align-top text-xs tabular-nums">{rowDuration(row)}</td>
                                            <td className="px-3 py-2 align-top">
                                                <div className="flex justify-end gap-2">
                                                    <InstanceActionBar
                                                        location={location}
                                                        launchLocation={location}
                                                        inviteLocation={location}
                                                        instanceLocation={location}
                                                        worldName={row?.worldName || ''}
                                                        showRefresh={false}
                                                        showInstanceInfo={false}
                                                    />
                                                    <Button type="button" size="sm" variant="outline" disabled={!location} onClick={() => openLocation(row)}>
                                                        Open
                                                    </Button>
                                                    <Button type="button" size="sm" variant="outline" onClick={() => openInfo(row)}>
                                                        Info
                                                    </Button>
                                                    <Button type="button" size="sm" variant="outline" disabled={!location} onClick={() => void deleteRow(row)}>
                                                        <Trash2Icon data-icon="inline-start" />
                                                        Delete
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                }) : (
                                    <tr>
                                        <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                                            No previous instances.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                </div>
                <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Page {currentPageIndex + 1} / {totalPages}</div>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={currentPageIndex <= 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>
                            Previous
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={currentPageIndex >= totalPages - 1} onClick={() => setPageIndex((value) => Math.min(totalPages - 1, value + 1))}>
                            Next
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange?.(false)}>Close</Button>
                    </div>
                </div>
                <Dialog open={Boolean(infoRow)} onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setInfoRow(null);
                        setInfoViewMode('table');
                    }
                }}>
                    <DialogContent className="max-h-[90vh] max-w-5xl overflow-auto">
                        <DialogHeader>
                            <DialogTitle>Previous Instance Info</DialogTitle>
                            <DialogDescription>{rowLocation(infoRow) || 'Instance details'}</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-2 text-sm sm:grid-cols-2">
                            <div><span className="text-muted-foreground">Created</span><div>{formatDate(infoRow?.created_at || infoRow?.createdAt)}</div></div>
                            <div><span className="text-muted-foreground">Duration</span><div>{rowDuration(infoRow)}</div></div>
                            <div><span className="text-muted-foreground">World</span><div>{infoRow?.worldName || '—'}</div></div>
                            <div><span className="text-muted-foreground">Group</span><div>{infoRow?.groupName || '—'}</div></div>
                            <div>
                                <span className="text-muted-foreground">Creator</span>
                                <div>
                                    <InstanceOwnerCell userId={infoRow ? rowOwnerUserId(infoRow) : ''} location={infoRow ? rowLocation(infoRow) : ''} endpoint={currentEndpoint} />
                                </div>
                            </div>
                        </div>
                        <Tabs value={infoViewMode} onValueChange={setInfoViewMode} className="min-h-0">
                            <div className="flex items-center justify-between gap-3">
                                <TabsList variant="line">
                                    <TabsTrigger value="table">Table View</TabsTrigger>
                                    <TabsTrigger value="chart">Chart View</TabsTrigger>
                                </TabsList>
                                <span className="text-xs text-muted-foreground">{infoData.players.length} players</span>
                            </div>
                            {infoData.status === 'running' ? (
                                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Loading instance details...</div>
                            ) : null}
                            {infoData.status === 'error' ? (
                                <div className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">{infoData.error}</div>
                            ) : null}
                            {infoData.status === 'ready' ? (
                                <>
                                    <TabsContent value="table" className="mt-2">
                                        <div className="max-h-80 overflow-auto rounded-md border">
                                    <table className="w-full text-left text-sm">
                                        <thead className="sticky top-0 bg-background">
                                            <tr className="border-b">
                                                <th className="px-3 py-2">Name</th>
                                                <th className="px-3 py-2">User ID</th>
                                                <th className="w-24 px-3 py-2">Visits</th>
                                                <th className="w-28 px-3 py-2">Time</th>
                                                <th className="w-44 px-3 py-2">First Seen</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {infoData.players.length ? infoData.players.map((player, index) => (
                                                <tr key={`${playerDisplayName(player)}:${playerUserId(player)}:${index}`} className="border-b last:border-b-0">
                                                    <td className="px-3 py-2 align-top">{playerDisplayName(player)}</td>
                                                    <td className="px-3 py-2 align-top font-mono text-xs text-muted-foreground">{playerUserId(player) || '—'}</td>
                                                    <td className="px-3 py-2 align-top text-xs tabular-nums">{player?.count || '—'}</td>
                                                    <td className="px-3 py-2 align-top text-xs tabular-nums">{Number(player?.time || 0) > 0 ? timeToText(Number(player.time)) : '—'}</td>
                                                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">{formatDate(player?.created_at || player?.createdAt)}</td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                                        No player detail rows for this instance.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                        </div>
                                    </TabsContent>
                                    <TabsContent value="chart" className="mt-2 max-h-[52vh] overflow-auto rounded-md border p-2">
                                        <PreviousInstanceInfoChart rows={infoData.details} />
                                    </TabsContent>
                                </>
                            ) : null}
                        </Tabs>
                        {infoViewMode === 'table' && infoData.details.length ? (
                            <details className="rounded-md border p-3">
                                <summary className="cursor-pointer text-sm font-medium">Leave Details ({infoData.details.length})</summary>
                                <div className="mt-3 max-h-48 overflow-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="sticky top-0 bg-background">
                                            <tr className="border-b">
                                                <th className="px-2 py-1">Left At</th>
                                                <th className="px-2 py-1">Name</th>
                                                <th className="px-2 py-1">Duration</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {infoData.details.map((detailRow, index) => (
                                                <tr key={`${detailRow?.created_at}:${detailRow?.user_id}:${index}`} className="border-b last:border-b-0">
                                                    <td className="px-2 py-1 text-muted-foreground">{formatDate(detailRow?.created_at)}</td>
                                                    <td className="px-2 py-1">{playerDisplayName(detailRow)}</td>
                                                    <td className="px-2 py-1 tabular-nums">{Number(detailRow?.time || 0) > 0 ? timeToText(Number(detailRow.time)) : '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </details>
                        ) : null}
                        {infoViewMode === 'table' ? (
                            <pre className="max-h-[45vh] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
                                {JSON.stringify(infoRow ?? null, null, 2)}
                            </pre>
                        ) : null}
                    </DialogContent>
                </Dialog>
            </DialogContent>
        </Dialog>
    );
}

export { PreviousInstancesTableDialog };
