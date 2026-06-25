import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AffinityBadge } from '@/components/affinity/AffinityBadge';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import {
    PageBackButton,
    PageDescription,
    PageHeader,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import {
    useKnownUserFact,
    useKnownUserFacts
} from '@/domain/users/useKnownUser';
import { openGameLogUser } from '@/features/game-log/gameLogUserLookup';
import {
    formatClock,
    formatDateFilterOrFallback,
    timeToText
} from '@/lib/dateTime';
import gameLogRepository from '@/repositories/gameLogRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import { openUserDialog, openWorldDialog } from '@/services/dialogService';
import { parseLocation } from '@/shared/utils/location';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { PreviousInstanceInfoChart } from './PreviousInstanceInfoChart';
import {
    normalizePlayerRows,
    playerDisplayName,
    playerUserId,
    rowDuration,
    rowLocation,
    rowOwnerUserId,
    rowWorldId
} from './previousInstancesRows';

function playerLeaveMs(player: any) {
    const value = new Date(
        player?.created_at || player?.createdAt || 0
    ).getTime();
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function playerJoinClock(player: any) {
    const leaveMs = playerLeaveMs(player);
    if (!leaveMs) {
        return '—';
    }
    const stayMs = Math.max(0, Number(player?.time || 0)) * 1000;
    return formatClock(leaveMs - stayMs) || '—';
}

function playerLeaveClock(player: any) {
    const leaveMs = playerLeaveMs(player);
    return leaveMs ? formatClock(leaveMs) || '—' : '—';
}

export function DialogEmptyState({ title, description, className = '' }: any) {
    return (
        <Empty
            className={['min-h-52 border', className].filter(Boolean).join(' ')}
        >
            <EmptyHeader>
                <EmptyTitle>{title}</EmptyTitle>
                {description ? (
                    <EmptyDescription>{description}</EmptyDescription>
                ) : null}
            </EmptyHeader>
        </Empty>
    );
}

export function DialogErrorState({ children }: any) {
    return (
        <Alert variant="destructive">
            <AlertDescription>{children}</AlertDescription>
        </Alert>
    );
}

function instanceDetailsSummary(row: any, t: any) {
    const parts = [row?.worldName, row?.groupName].filter(Boolean);
    if (parts.length) {
        return parts.join(' / ');
    }
    const dateText = formatDateFilterOrFallback(
        row?.created_at || row?.createdAt,
        'long'
    );
    return dateText !== '-'
        ? dateText
        : t('dialog.previous_instances.description.instance_details');
}

export function InstanceOwnerCell({
    userId,
    location = '',
    endpoint = ''
}: any) {
    const knownUser = useKnownUserFact(userId, { endpoint });
    const displayName =
        knownUser?.displayName ||
        knownUser?.username ||
        knownUser?.name ||
        userId;

    useEffect(() => {
        if (!userId || displayName !== userId) {
            return;
        }
        userProfileRepository
            .getUserProfile({ userId, endpoint })
            .catch(() => {});
    }, [displayName, endpoint, userId]);

    if (!userId) {
        return <span className="text-muted-foreground">-</span>;
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    className="hover:text-primary h-auto max-w-full flex-col items-start justify-start gap-0 p-0 text-left text-xs"
                    onClick={() =>
                        openUserDialog({
                            userId,
                            title: displayName || undefined,
                            seedData: knownUser || null
                        })
                    }
                >
                    <span className="truncate">{displayName || userId}</span>
                    {displayName && displayName !== userId ? (
                        <span className="text-muted-foreground max-w-full truncate text-xs">
                            {userId}
                        </span>
                    ) : null}
                </Button>
            </TooltipTrigger>
            <TooltipContent>
                {[displayName || userId, userId, location]
                    .filter(Boolean)
                    .join('\n')}
            </TooltipContent>
        </Tooltip>
    );
}

function PreviousInstancePlayerNameButton({
    player,
    displayName,
    knownUser = null
}: any) {
    const { t } = useTranslation();
    const userId = playerUserId(player);
    const canOpenUser = Boolean(userId || displayName);

    if (!canOpenUser) {
        return <span className="text-muted-foreground">-</span>;
    }

    const isFavorite = Boolean(knownUser?.isFavorite || knownUser?.$isFavorite);

    return (
        <Button
            type="button"
            variant="ghost"
            className="hover:text-primary h-auto max-w-full min-w-0 justify-start gap-1.5 p-0 text-left font-normal"
            onClick={() => {
                if (userId) {
                    openUserDialog({
                        userId,
                        title: displayName || undefined,
                        seedData: knownUser || null
                    });
                    return;
                }
                openGameLogUser({ ...player, displayName }, t);
            }}
        >
            <span className="truncate">{displayName || userId}</span>
            <AffinityBadge
                isFriend={knownUser?.isFriend}
                isFavorite={isFavorite}
            />
        </Button>
    );
}

function InstanceWorldCell({ row }: any) {
    const worldId = rowWorldId(row);
    const worldName = row?.worldName || '';

    if (!worldId && !worldName) {
        return <span className="text-muted-foreground">-</span>;
    }

    if (!worldId) {
        return <span>{worldName}</span>;
    }

    return (
        <Button
            type="button"
            variant="ghost"
            className="hover:text-primary h-auto max-w-full min-w-0 justify-start p-0 text-left font-normal"
            onClick={() =>
                openWorldDialog({
                    worldId,
                    title: worldName || undefined
                })
            }
        >
            <span className="truncate">{worldName || worldId}</span>
        </Button>
    );
}

export function PreviousInstanceDetailsPanel({
    row,
    onBack = null,
    showTitle = true,
    className = ''
}: any) {
    const { t } = useTranslation();

    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const [detailsViewMode, setDetailsViewMode] = useState('players');
    const [infoData, setInfoData] = useState<any>({
        status: 'idle',
        error: '',
        players: [],
        details: []
    });
    const playerFactIds = useMemo(() => {
        const seen = new Set();
        const ids = [];
        for (const player of [...infoData.players, ...infoData.details]) {
            const userId = playerUserId(player);
            if (!userId || seen.has(userId)) {
                continue;
            }
            seen.add(userId);
            ids.push(userId);
        }
        return ids;
    }, [infoData.details, infoData.players]);
    const knownPlayersById = useKnownUserFacts(playerFactIds, {
        endpoint: currentEndpoint
    });
    const missingPlayerProfileIds = useMemo(() => {
        const ids = [];
        for (const userId of playerFactIds) {
            if (knownPlayersById[userId]?.displayName) {
                continue;
            }
            const row = [...infoData.players, ...infoData.details].find(
                (player: any) => playerUserId(player) === userId
            );
            const displayName = playerDisplayName(row);
            if (
                !displayName ||
                displayName === '-' ||
                displayName === '\u2014' ||
                displayName === userId
            ) {
                ids.push(userId);
            }
        }
        return ids;
    }, [infoData.details, infoData.players, knownPlayersById, playerFactIds]);

    useEffect(() => {
        setDetailsViewMode('players');
    }, [row]);

    useEffect(() => {
        if (!row) {
            setInfoData({
                status: 'idle',
                error: '',
                players: [],
                details: []
            });
            return undefined;
        }

        const location = rowLocation(row);
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
            .then(([players, details]: any) => {
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
            .catch((error: any) => {
                if (!active) {
                    return;
                }
                setInfoData({
                    status: 'error',
                    error:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'dialog.previous_instances.error.failed_to_load_instance_details'
                              ),
                    players: [],
                    details: []
                });
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, row, t]);

    useEffect(() => {
        if (!missingPlayerProfileIds.length) {
            return;
        }

        Promise.allSettled(
            missingPlayerProfileIds.slice(0, 50).map((userId: any) =>
                userProfileRepository.getUserProfile({
                    userId,
                    endpoint: currentEndpoint
                })
            )
        ).catch(() => {});
    }, [currentEndpoint, missingPlayerProfileIds]);

    function resolvePlayerDisplayName(player: any) {
        const userId = playerUserId(player);
        const displayName = playerDisplayName(player);
        if (
            displayName &&
            displayName !== '-' &&
            displayName !== '\u2014' &&
            displayName !== userId
        ) {
            return displayName;
        }
        const knownUser = knownPlayersById[userId];
        return (
            knownUser?.displayName ||
            knownUser?.username ||
            displayName ||
            userId ||
            '-'
        );
    }

    if (!row) {
        return (
            <DialogEmptyState
                title={t(
                    'dialog.previous_instances.empty.no_instance_selected'
                )}
                description={t(
                    'dialog.previous_instances.description.select_an_instance_row_to_view_its_details'
                )}
                className={className}
            />
        );
    }

    const parsedLocation = parseLocation(rowLocation(row));

    return (
        <div
            className={[
                'flex min-h-0 flex-col gap-3 overflow-hidden',
                className
            ]
                .filter(Boolean)
                .join(' ')}
        >
            {showTitle || onBack ? (
                <PageToolbar className="pb-0">
                    <PageToolbarRow className="items-center">
                        {onBack ? (
                            <PageBackButton
                                label={t('common.actions.back')}
                                onClick={onBack}
                            />
                        ) : null}
                        {showTitle ? (
                            <PageHeader className="min-w-0 p-0">
                                <PageTitle>
                                    {t('dialog.previous_instances.info')}
                                </PageTitle>
                                <PageDescription className="truncate">
                                    {instanceDetailsSummary(row, t)}
                                </PageDescription>
                            </PageHeader>
                        ) : null}
                    </PageToolbarRow>
                </PageToolbar>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pr-1">
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                        <span className="text-muted-foreground">
                            {t('table.previous_instances.date')}
                        </span>
                        <div>
                            {formatDateFilterOrFallback(
                                row?.created_at || row?.createdAt,
                                'long'
                            )}
                        </div>
                    </div>
                    <div>
                        <span className="text-muted-foreground">
                            {t('table.previous_instances.time')}
                        </span>
                        <div>{rowDuration(row)}</div>
                    </div>
                    <div>
                        <span className="text-muted-foreground">
                            {t('table.previous_instances.world')}
                        </span>
                        <div className="min-w-0">
                            <InstanceWorldCell row={row} />
                        </div>
                    </div>
                    <div>
                        <span className="text-muted-foreground">
                            {t('dialog.new_instance.group')}
                        </span>
                        <div>{row?.groupName || '-'}</div>
                    </div>
                    <div>
                        <span className="text-muted-foreground">
                            {t('table.previous_instances.instance_creator')}
                        </span>
                        <div>
                            <InstanceOwnerCell
                                userId={rowOwnerUserId(row)}
                                location={rowLocation(row)}
                                endpoint={currentEndpoint}
                            />
                        </div>
                    </div>
                    <div>
                        <span className="text-muted-foreground">
                            {t('dialog.new_instance.region')}
                        </span>
                        <div className="uppercase">
                            {parsedLocation.region || '-'}
                        </div>
                    </div>
                    <div>
                        <span className="text-muted-foreground">
                            {t('dialog.new_instance.instance_id')}
                        </span>
                        <div className="tabular-nums">
                            {parsedLocation.instanceName
                                ? `#${parsedLocation.instanceName}`
                                : '-'}
                        </div>
                    </div>
                </div>
                <InstanceActionBar
                    target={{
                        location: rowLocation(row),
                        worldName: row?.worldName || ''
                    }}
                    showRefresh={false}
                    showInstanceInfo={false}
                    className="flex-wrap"
                />
                <Tabs
                    value={detailsViewMode}
                    onValueChange={setDetailsViewMode}
                    className="flex min-h-0 shrink-0 flex-col"
                >
                    <div className="flex items-center justify-between gap-3">
                        <TabsList variant="line">
                            <TabsTrigger value="players">
                                {t('dialog.previous_instances.table_view')}
                            </TabsTrigger>
                            <TabsTrigger value="timeline">
                                {t('dialog.previous_instances.chart_view')}
                            </TabsTrigger>
                        </TabsList>
                        <span className="text-muted-foreground text-xs">
                            {t(
                                'dialog.previous_instances.label.players_count',
                                {
                                    count: infoData.players.length
                                }
                            )}
                        </span>
                    </div>
                    {infoData.status === 'running' ? (
                        <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed p-4 text-sm">
                            <Spinner className="size-4" />
                            <span>
                                {t(
                                    'dialog.previous_instances.loading.loading_instance_details'
                                )}
                            </span>
                        </div>
                    ) : null}
                    {infoData.status === 'error' ? (
                        <DialogErrorState>{infoData.error}</DialogErrorState>
                    ) : null}
                    {infoData.status === 'ready' ? (
                        <>
                            <TabsContent
                                value="players"
                                className="mt-2 min-h-0"
                            >
                                <div className="max-h-[32vh] min-h-0 overflow-auto rounded-md border">
                                    <Table>
                                        <TableHeader className="vrcx-0-table-header sticky top-0">
                                            <TableRow>
                                                <TableHead>
                                                    {t(
                                                        'table.previous_instances.display_name'
                                                    )}
                                                </TableHead>
                                                <TableHead className="w-20">
                                                    {t(
                                                        'dialog.world.info.visits'
                                                    )}
                                                </TableHead>
                                                <TableHead className="w-20">
                                                    {t(
                                                        'table.previous_instances.joined'
                                                    )}
                                                </TableHead>
                                                <TableHead className="w-20">
                                                    {t(
                                                        'table.previous_instances.left'
                                                    )}
                                                </TableHead>
                                                <TableHead className="w-28">
                                                    {t(
                                                        'table.previous_instances.time'
                                                    )}
                                                </TableHead>
                                                <TableHead className="w-44">
                                                    {t(
                                                        'table.previous_instances.date'
                                                    )}
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {infoData.players.length ? (
                                                infoData.players.map(
                                                    (
                                                        player: any,
                                                        index: any
                                                    ) => (
                                                        <TableRow
                                                            key={`${playerDisplayName(player)}:${playerUserId(player)}:${index}`}
                                                        >
                                                            <TableCell className="align-top">
                                                                <PreviousInstancePlayerNameButton
                                                                    player={
                                                                        player
                                                                    }
                                                                    displayName={resolvePlayerDisplayName(
                                                                        player
                                                                    )}
                                                                    knownUser={
                                                                        knownPlayersById[
                                                                            playerUserId(
                                                                                player
                                                                            )
                                                                        ]
                                                                    }
                                                                />
                                                            </TableCell>
                                                            <TableCell className="align-top text-xs tabular-nums">
                                                                {player?.count ||
                                                                    '-'}
                                                            </TableCell>
                                                            <TableCell className="text-muted-foreground align-top text-xs tabular-nums">
                                                                {playerJoinClock(
                                                                    player
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="text-muted-foreground align-top text-xs tabular-nums">
                                                                {playerLeaveClock(
                                                                    player
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="align-top text-xs tabular-nums">
                                                                {Number(
                                                                    player?.time ||
                                                                        0
                                                                ) > 0
                                                                    ? timeToText(
                                                                          Number(
                                                                              player.time
                                                                          )
                                                                      )
                                                                    : '-'}
                                                            </TableCell>
                                                            <TableCell className="text-muted-foreground align-top text-xs">
                                                                {formatDateFilterOrFallback(
                                                                    player?.created_at ||
                                                                        player?.createdAt,
                                                                    'long'
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                )
                                            ) : (
                                                <TableRow>
                                                    <TableCell
                                                        colSpan={6}
                                                        className="py-6 text-center"
                                                    >
                                                        {t(
                                                            'dialog.previous_instances.empty.no_player_detail_rows_for_this_instance'
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </TabsContent>
                            <TabsContent
                                value="timeline"
                                className="mt-2 max-h-[52vh] overflow-auto rounded-md border p-2"
                            >
                                <PreviousInstanceInfoChart
                                    rows={infoData.details}
                                />
                            </TabsContent>
                        </>
                    ) : null}
                </Tabs>
            </div>
        </div>
    );
}
