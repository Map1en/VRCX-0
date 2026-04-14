import { useEffect, useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { Location } from '@/components/Location.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar.jsx';
import { timeToText } from '@/lib/dateTime.js';
import { userProfileRepository } from '@/repositories/index.js';
import { database } from '@/services/database/index.js';
import { openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select.jsx';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs.jsx';

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

function rowDurationValue(row) {
    const value = Number(row?.time || row?.duration || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
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

function rowTitle(row) {
    return row?.worldName || row?.groupName || rowLocation(row) || '—';
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
                <span className="max-w-full truncate text-[10px] text-muted-foreground">{userId}</span>
            ) : null}
        </Button>
    );
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
    const [viewMode, setViewMode] = useState('table');
    const [infoRow, setInfoRow] = useState(null);
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
            setViewMode('table');
            if (autoOpenInfo && Array.isArray(instances) && instances.length > 0) {
                setInfoRow(instances[0]);
            }
        } else {
            setInfoRow(null);
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
    const visibleChartRows = useMemo(
        () => [...visibleRows].sort((left, right) => rowDurationValue(right) - rowDurationValue(left)),
        [visibleRows]
    );
    const maxChartDuration = useMemo(
        () => Math.max(1, ...visibleChartRows.map((row) => rowDurationValue(row))),
        [visibleChartRows]
    );

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
                        <Tabs value={viewMode} onValueChange={setViewMode}>
                            <TabsList variant="line">
                                <TabsTrigger value="table">Table View</TabsTrigger>
                                <TabsTrigger value="chart">Chart View</TabsTrigger>
                            </TabsList>
                        </Tabs>
                        <span className="text-sm text-muted-foreground">Rows</span>
                        <Select
                            value={String(pageSize)}
                            onValueChange={(value) => {
                                setPageSize(Number.parseInt(value, 10) || 10);
                                setPageIndex(0);
                            }}>
                            <SelectTrigger size="sm" className="w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {[10, 25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                    {viewMode === 'table' ? (
                        <table className="w-full text-left text-sm">
                            <thead className="sticky top-0 bg-background">
                                <tr className="border-b">
                                    <th className="w-44 px-3 py-2">
                                        <Button type="button" variant="ghost" size="sm" className="h-auto px-1" onClick={() => setSortDesc((value) => !value)}>
                                            Created
                                            {sortDesc ? <ArrowDownIcon className="size-3.5" /> : <ArrowUpIcon className="size-3.5" />}
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
                                            <td className="max-w-[26rem] px-3 py-2 align-top text-xs">
                                                <button type="button" className="max-w-full text-left hover:underline" onClick={() => openInfo(row)}>
                                                    {location ? renderLocationCell(row) : '—'}
                                                </button>
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
                                                        <Trash2Icon className="size-3.5" />
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
                    ) : (
                        <div className="h-full overflow-auto p-2">
                            {visibleChartRows.length ? (
                                <div className="space-y-2">
                                    {visibleChartRows.map((row, index) => {
                                        const location = rowLocation(row);
                                        const durationValue = rowDurationValue(row);
                                        const barWidth = Math.max(8, Math.round((durationValue / maxChartDuration) * 100));
                                        return (
                                            <div key={`${location}:${row?.id || row?.created_at || row?.createdAt || index}`} className="rounded-md border bg-muted/10 p-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openInfo(row)}>
                                                        <div className="truncate text-sm font-medium">{rowTitle(row)}</div>
                                                        <div className="truncate text-xs text-muted-foreground">
                                                            {[formatDate(row?.created_at || row?.createdAt), row?.groupName].filter(Boolean).join(' · ') || '—'}
                                                        </div>
                                                    </button>
                                                    <Badge variant="outline" className="shrink-0 tabular-nums">
                                                        {rowDuration(row)}
                                                    </Badge>
                                                </div>
                                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                                                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${barWidth}%` }} />
                                                </div>
                                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                                    <div className="text-xs text-muted-foreground">
                                                        {[row?.worldName, row?.groupName].filter(Boolean).join(' / ') || location || '—'}
                                                    </div>
                                                    <div className="flex flex-wrap justify-end gap-2">
                                                        <InstanceActionBar
                                                            location={location}
                                                            launchLocation={location}
                                                            inviteLocation={location}
                                                            instanceLocation={location}
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
                                                            <Trash2Icon className="size-3.5" />
                                                            Delete
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                                    No previous instances.
                                </div>
                            )}
                        </div>
                    )}
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
                    }
                }}>
                    <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto">
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
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-medium">Players</h4>
                                <span className="text-xs text-muted-foreground">{infoData.players.length} players</span>
                            </div>
                            {infoData.status === 'running' ? (
                                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Loading instance details...</div>
                            ) : null}
                            {infoData.status === 'error' ? (
                                <div className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">{infoData.error}</div>
                            ) : null}
                            {infoData.status === 'ready' ? (
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
                            ) : null}
                        </div>
                        {infoData.details.length ? (
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
                        <pre className="max-h-[45vh] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
                            {JSON.stringify(infoRow ?? null, null, 2)}
                        </pre>
                    </DialogContent>
                </Dialog>
            </DialogContent>
        </Dialog>
    );
}

export { PreviousInstancesTableDialog };
