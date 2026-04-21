import { useEffect, useMemo, useState } from 'react';

import { InstanceActionBar } from '@/components/instances/InstanceActionBar.jsx';
import { timeToText } from '@/lib/dateTime.js';
import { gameLogRepository } from '@/repositories/index.js';
import { openWorldDialog } from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

function formatDate(value) {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

function rowLocation(row) {
    return (
        row?.$location?.tag || row?.location || row?.worldId || row?.id || ''
    );
}

function rowWorldId(row) {
    const location = rowLocation(row);
    return parseLocation(location).worldId || '';
}

function rowDuration(row) {
    const value = Number(row?.time || row?.duration || 0);
    return Number.isFinite(value) && value > 0 ? timeToText(value) : '—';
}

function rowDurationValue(row) {
    const value = Number(row?.time || row?.duration || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function rowTitle(row) {
    return row?.worldName || row?.groupName || rowLocation(row) || '—';
}

function normalizePlayerRows(players) {
    const rows =
        players instanceof Map
            ? Array.from(players.values())
            : Array.isArray(players)
              ? players
              : [];
    return rows.sort(
        (left, right) => Number(right?.time || 0) - Number(left?.time || 0)
    );
}

function playerDisplayName(row) {
    return row?.displayName || row?.display_name || '—';
}

function playerUserId(row) {
    return row?.userId || row?.user_id || '';
}

function PreviousInstancesDialog({
    open,
    onOpenChange,
    title = 'Previous Instances',
    instances = []
}) {
    const rows = useMemo(() => {
        const nextRows = Array.isArray(instances) ? instances : [];
        return [...nextRows].sort(
            (left, right) =>
                new Date(right?.created_at || right?.createdAt || 0).getTime() -
                new Date(left?.created_at || left?.createdAt || 0).getTime()
        );
    }, [instances]);
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
            setViewMode('table');
        } else {
            setInfoRow(null);
        }
    }, [open]);

    useEffect(() => {
        if (!infoRow) {
            setInfoData({
                status: 'idle',
                error: '',
                players: [],
                details: []
            });
            return undefined;
        }

        const location = rowLocation(infoRow);
        if (!location) {
            setInfoData({
                status: 'ready',
                error: '',
                players: [],
                details: []
            });
            return undefined;
        }

        let active = true;
        setInfoData({ status: 'running', error: '', players: [], details: [] });

        Promise.all([
            gameLogRepository.getPlayersFromInstance(location),
            gameLogRepository.getPlayerDetailFromInstance(location)
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
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Failed to load instance details.',
                    players: [],
                    details: []
                });
            });

        return () => {
            active = false;
        };
    }, [infoRow]);

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

    const chartRows = useMemo(
        () =>
            [...rows].sort(
                (left, right) =>
                    rowDurationValue(right) - rowDurationValue(left)
            ),
        [rows]
    );
    const maxChartDuration = useMemo(
        () => Math.max(1, ...chartRows.map((row) => rowDurationValue(row))),
        [chartRows]
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] max-w-[min(92vw,72rem)] flex-col">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        {rows.length
                            ? `${rows.length} recorded instance visits.`
                            : 'No recorded instance visits.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center justify-between gap-3">
                    <Tabs value={viewMode} onValueChange={setViewMode}>
                        <TabsList variant="line">
                            <TabsTrigger value="table">Table View</TabsTrigger>
                            <TabsTrigger value="chart">Chart View</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange?.(false)}
                    >
                        Close
                    </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                    {viewMode === 'table' ? (
                        <div className="min-h-0 overflow-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-background sticky top-0">
                                    <tr className="border-b">
                                        <th className="w-44 px-3 py-2">
                                            Created
                                        </th>
                                        <th className="px-3 py-2">Instance</th>
                                        <th className="w-48 px-3 py-2">
                                            World / Group
                                        </th>
                                        <th className="w-24 px-3 py-2">
                                            Duration
                                        </th>
                                        <th className="w-72 px-3 py-2 text-right">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.length ? (
                                        rows.map((instance, index) => {
                                            const location =
                                                rowLocation(instance);
                                            return (
                                                <tr
                                                    key={`${location}:${instance?.created_at || instance?.createdAt || index}`}
                                                    className="border-b last:border-b-0"
                                                >
                                                    <td className="text-muted-foreground px-3 py-2 align-top text-xs">
                                                        {formatDate(
                                                            instance?.created_at ||
                                                                instance?.createdAt
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 align-top text-xs">
                                                        <Button
                                                            type="button"
                                                            variant="link"
                                                            className="h-auto max-w-full justify-start p-0 text-left font-normal"
                                                            onClick={() =>
                                                                openInfo(
                                                                    instance
                                                                )
                                                            }
                                                        >
                                                            <span className="block truncate font-mono">
                                                                {rowTitle(
                                                                    instance
                                                                )}
                                                            </span>
                                                        </Button>
                                                    </td>
                                                    <td className="text-muted-foreground px-3 py-2 align-top text-xs">
                                                        {[
                                                            instance?.worldName,
                                                            instance?.groupName
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' / ') || '—'}
                                                    </td>
                                                    <td className="px-3 py-2 align-top text-xs tabular-nums">
                                                        {rowDuration(instance)}
                                                    </td>
                                                    <td className="px-3 py-2 align-top">
                                                        <div className="flex justify-end gap-2">
                                                            <InstanceActionBar
                                                                location={
                                                                    location
                                                                }
                                                                launchLocation={
                                                                    location
                                                                }
                                                                inviteLocation={
                                                                    location
                                                                }
                                                                instanceLocation={
                                                                    location
                                                                }
                                                                worldName={
                                                                    instance?.worldName ||
                                                                    ''
                                                                }
                                                                showRefresh={
                                                                    false
                                                                }
                                                                showInstanceInfo={
                                                                    false
                                                                }
                                                            />
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                disabled={
                                                                    !location
                                                                }
                                                                onClick={() =>
                                                                    openLocation(
                                                                        instance
                                                                    )
                                                                }
                                                            >
                                                                Open
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() =>
                                                                    openInfo(
                                                                        instance
                                                                    )
                                                                }
                                                            >
                                                                Info
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    ) : (
                                        <tr>
                                            <td
                                                colSpan={5}
                                                className="text-muted-foreground px-3 py-8 text-center text-sm"
                                            >
                                                No previous instances.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="h-full overflow-auto p-2">
                            {chartRows.length ? (
                                <div className="flex flex-col gap-2">
                                    {chartRows.map((instance, index) => {
                                        const location = rowLocation(instance);
                                        const durationValue =
                                            rowDurationValue(instance);
                                        const percent = Math.max(
                                            8,
                                            Math.round(
                                                (durationValue /
                                                    maxChartDuration) *
                                                    100
                                            )
                                        );
                                        return (
                                            <div
                                                key={`${location}:${instance?.created_at || instance?.createdAt || index}`}
                                                className="bg-muted/10 rounded-md border p-3"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="h-auto min-w-0 flex-1 flex-col items-start justify-start p-0 text-left font-normal hover:bg-transparent"
                                                        onClick={() =>
                                                            openInfo(instance)
                                                        }
                                                    >
                                                        <span className="truncate text-sm font-medium">
                                                            {rowTitle(instance)}
                                                        </span>
                                                        <span className="text-muted-foreground truncate text-xs">
                                                            {[
                                                                formatDate(
                                                                    instance?.created_at ||
                                                                        instance?.createdAt
                                                                ),
                                                                instance?.groupName
                                                            ]
                                                                .filter(Boolean)
                                                                .join(' · ') ||
                                                                '—'}
                                                        </span>
                                                    </Button>
                                                    <Badge
                                                        variant="outline"
                                                        className="shrink-0 tabular-nums"
                                                    >
                                                        {rowDuration(instance)}
                                                    </Badge>
                                                </div>
                                                <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full">
                                                    <div
                                                        className="bg-primary h-full rounded-full transition-[width]"
                                                        style={{
                                                            width: `${percent}%`
                                                        }}
                                                    />
                                                </div>
                                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                                    <div className="text-muted-foreground text-xs">
                                                        {[
                                                            instance?.worldName,
                                                            instance?.groupName
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' / ') ||
                                                            location ||
                                                            '—'}
                                                    </div>
                                                    <div className="flex flex-wrap justify-end gap-2">
                                                        <InstanceActionBar
                                                            location={location}
                                                            launchLocation={
                                                                location
                                                            }
                                                            inviteLocation={
                                                                location
                                                            }
                                                            instanceLocation={
                                                                location
                                                            }
                                                            worldName={
                                                                instance?.worldName ||
                                                                ''
                                                            }
                                                            showRefresh={false}
                                                            showInstanceInfo={
                                                                false
                                                            }
                                                        />
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={!location}
                                                            onClick={() =>
                                                                openLocation(
                                                                    instance
                                                                )
                                                            }
                                                        >
                                                            Open
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() =>
                                                                openInfo(
                                                                    instance
                                                                )
                                                            }
                                                        >
                                                            Info
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                                    No previous instances.
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <Dialog
                    open={Boolean(infoRow)}
                    onOpenChange={(nextOpen) => {
                        if (!nextOpen) {
                            setInfoRow(null);
                        }
                    }}
                >
                    <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto">
                        <DialogHeader>
                            <DialogTitle>Previous Instance Info</DialogTitle>
                            <DialogDescription>
                                {rowLocation(infoRow) || 'Instance details'}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-2 text-sm sm:grid-cols-2">
                            <div>
                                <span className="text-muted-foreground">
                                    Created
                                </span>
                                <div>
                                    {formatDate(
                                        infoRow?.created_at ||
                                            infoRow?.createdAt
                                    )}
                                </div>
                            </div>
                            <div>
                                <span className="text-muted-foreground">
                                    Duration
                                </span>
                                <div>{rowDuration(infoRow)}</div>
                            </div>
                            <div>
                                <span className="text-muted-foreground">
                                    World
                                </span>
                                <div>{infoRow?.worldName || '—'}</div>
                            </div>
                            <div>
                                <span className="text-muted-foreground">
                                    Group
                                </span>
                                <div>{infoRow?.groupName || '—'}</div>
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-medium">Players</h4>
                                <span className="text-muted-foreground text-xs">
                                    {infoData.players.length} players
                                </span>
                            </div>
                            {infoData.status === 'running' ? (
                                <div className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                                    Loading instance details...
                                </div>
                            ) : null}
                            {infoData.status === 'error' ? (
                                <div className="border-destructive/40 text-destructive rounded-md border p-4 text-sm">
                                    {infoData.error}
                                </div>
                            ) : null}
                            {infoData.status === 'ready' ? (
                                <div className="max-h-80 overflow-auto rounded-md border">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-background sticky top-0">
                                            <tr className="border-b">
                                                <th className="px-3 py-2">
                                                    Name
                                                </th>
                                                <th className="px-3 py-2">
                                                    User ID
                                                </th>
                                                <th className="w-24 px-3 py-2">
                                                    Visits
                                                </th>
                                                <th className="w-28 px-3 py-2">
                                                    Time
                                                </th>
                                                <th className="w-44 px-3 py-2">
                                                    First Seen
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {infoData.players.length ? (
                                                infoData.players.map(
                                                    (player, index) => (
                                                        <tr
                                                            key={`${playerDisplayName(player)}:${playerUserId(player)}:${index}`}
                                                            className="border-b last:border-b-0"
                                                        >
                                                            <td className="px-3 py-2 align-top">
                                                                {playerDisplayName(
                                                                    player
                                                                )}
                                                            </td>
                                                            <td className="text-muted-foreground px-3 py-2 align-top font-mono text-xs">
                                                                {playerUserId(
                                                                    player
                                                                ) || '—'}
                                                            </td>
                                                            <td className="px-3 py-2 align-top text-xs tabular-nums">
                                                                {player?.count ||
                                                                    '—'}
                                                            </td>
                                                            <td className="px-3 py-2 align-top text-xs tabular-nums">
                                                                {Number(
                                                                    player?.time ||
                                                                        0
                                                                ) > 0
                                                                    ? timeToText(
                                                                          Number(
                                                                              player.time
                                                                          )
                                                                      )
                                                                    : '—'}
                                                            </td>
                                                            <td className="text-muted-foreground px-3 py-2 align-top text-xs">
                                                                {formatDate(
                                                                    player?.created_at ||
                                                                        player?.createdAt
                                                                )}
                                                            </td>
                                                        </tr>
                                                    )
                                                )
                                            ) : (
                                                <tr>
                                                    <td
                                                        colSpan={5}
                                                        className="text-muted-foreground px-3 py-6 text-center text-sm"
                                                    >
                                                        No player detail rows
                                                        for this instance.
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
                                <summary className="cursor-pointer text-sm font-medium">
                                    Leave Details ({infoData.details.length})
                                </summary>
                                <div className="mt-3 max-h-48 overflow-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-background sticky top-0">
                                            <tr className="border-b">
                                                <th className="px-2 py-1">
                                                    Left At
                                                </th>
                                                <th className="px-2 py-1">
                                                    Name
                                                </th>
                                                <th className="px-2 py-1">
                                                    Duration
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {infoData.details.map(
                                                (detailRow, index) => (
                                                    <tr
                                                        key={`${detailRow?.created_at}:${detailRow?.user_id}:${index}`}
                                                        className="border-b last:border-b-0"
                                                    >
                                                        <td className="text-muted-foreground px-2 py-1">
                                                            {formatDate(
                                                                detailRow?.created_at
                                                            )}
                                                        </td>
                                                        <td className="px-2 py-1">
                                                            {playerDisplayName(
                                                                detailRow
                                                            )}
                                                        </td>
                                                        <td className="px-2 py-1 tabular-nums">
                                                            {Number(
                                                                detailRow?.time ||
                                                                    0
                                                            ) > 0
                                                                ? timeToText(
                                                                      Number(
                                                                          detailRow.time
                                                                      )
                                                                  )
                                                                : '—'}
                                                        </td>
                                                    </tr>
                                                )
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </details>
                        ) : null}
                    </DialogContent>
                </Dialog>
            </DialogContent>
        </Dialog>
    );
}

export { PreviousInstancesDialog };
