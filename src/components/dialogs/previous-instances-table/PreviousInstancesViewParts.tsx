import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { CopyIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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
import type { LoadStatus } from '@/domain/shared/types';
import {
    formatClock,
    formatDateFilterOrFallback,
    timeToText
} from '@/lib/dateTime';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import { useKnownUserFact, useKnownUserFacts } from '@/lib/useKnownUser';
import { cn } from '@/lib/utils';
import gameLogRepository from '@/repositories/gameLogRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import { openUserDialog, openWorldDialog } from '@/services/dialogService';
import { openGameLogUser } from '@/services/gameLogUserDialogService';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType';
import {
    getLocationText,
    parseLocation,
    resolveRegion,
    translateAccessType
} from '@/shared/utils/location';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyContent,
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

import { PreviousInstanceInfoChart } from './PreviousInstanceInfoChart';
import {
    normalizePlayerRows,
    playerJoinMs,
    playerLeaveMs,
    playerDisplayName,
    playerUserId,
    rowDuration,
    rowLocation,
    rowOwnerUserId,
    rowWorldId
} from './previousInstancesRows';
import type {
    PreviousInstanceKnownUser,
    PreviousInstancePlayerRow,
    PreviousInstanceRow
} from './previousInstancesRows';

const DETAILS_LOADING_INDICATOR_DELAY_MS = 150;

type PreviousInstancePlayerClockRow = Parameters<typeof playerJoinMs>[0];

function playerJoinClock(player: PreviousInstancePlayerClockRow) {
    const joinedMs = playerJoinMs(player);
    if (!joinedMs) {
        return '—';
    }
    return formatClock(joinedMs) || '—';
}

function playerLeaveClock(player: PreviousInstancePlayerClockRow) {
    const leaveMs = playerLeaveMs(player);
    return leaveMs ? formatClock(leaveMs) || '—' : '—';
}

export function DialogEmptyState({
    title,
    description,
    action,
    className = ''
}: {
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
    className?: string;
}) {
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
            {action ? <EmptyContent>{action}</EmptyContent> : null}
        </Empty>
    );
}

export function DialogErrorState({ children }: { children: ReactNode }) {
    return (
        <Alert variant="destructive">
            <AlertDescription>{children}</AlertDescription>
        </Alert>
    );
}

export function instanceDetailsSummary(
    row: PreviousInstanceRow | null,
    t: TFunction
) {
    const parsedLocation = parseLocation(rowLocation(row));
    const worldName =
        row?.worldName || row?.$location?.worldName || parsedLocation.worldId;
    const groupName = row?.groupName || row?.$location?.groupName || '';
    const accessTypeLabel = parsedLocation.instanceId
        ? translateAccessType(
              parsedLocation.accessTypeName,
              t,
              accessTypeLocaleKeyMap
          )
        : '';
    const locationText = getLocationText(parsedLocation, {
        hint: worldName,
        worldName,
        accessTypeLabel,
        t
    });
    const parts = [
        locationText || worldName,
        parsedLocation.instanceName ? `#${parsedLocation.instanceName}` : '',
        resolveRegion(parsedLocation).toUpperCase(),
        groupName ? `(${groupName})` : ''
    ].filter(Boolean);
    if (parts.length) {
        return parts.join(' · ');
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
    endpoint = ''
}: {
    userId: string;
    endpoint?: string;
}) {
    const knownUser = useKnownUserFact(userId, { endpoint });
    const knownDisplayName = String(
        knownUser?.displayName || knownUser?.username || knownUser?.name || ''
    );
    const userProfileQuery = useQuery({
        queryKey: queryKeys.user(userId, endpoint),
        queryFn: () => userProfileRepository.getUserProfile({ userId }),
        enabled: Boolean(
            userId && (!knownDisplayName || knownDisplayName === userId)
        ),
        staleTime: entityQueryPolicies.userAvatarLookup.staleTime,
        gcTime: entityQueryPolicies.userAvatarLookup.gcTime,
        retry: entityQueryPolicies.userAvatarLookup.retry,
        refetchOnWindowFocus:
            entityQueryPolicies.userAvatarLookup.refetchOnWindowFocus
    });
    const queriedUser = userProfileQuery.data;
    const displayName = String(
        queriedUser?.displayName ||
            queriedUser?.username ||
            queriedUser?.name ||
            knownDisplayName ||
            userId
    );

    if (!userId) {
        return <span className="text-muted-foreground">-</span>;
    }

    return (
        <Button
            type="button"
            variant="ghost"
            className="hover:text-primary h-auto max-w-full justify-start p-0 text-left text-xs"
            onClick={() =>
                openUserDialog({
                    userId,
                    title: displayName || undefined,
                    seedData: queriedUser || knownUser || null
                })
            }
        >
            <span className="truncate">{displayName || userId}</span>
        </Button>
    );
}

function PreviousInstancePlayerNameButton({
    player,
    displayName,
    knownUser = null,
    isFriend = false,
    isFavorite = false
}: {
    player: PreviousInstancePlayerRow;
    displayName: string;
    knownUser?: PreviousInstanceKnownUser | null;
    isFriend?: boolean;
    isFavorite?: boolean;
}) {
    const { t } = useTranslation();
    const userId = playerUserId(player);
    const canOpenUser = Boolean(userId || displayName);

    if (!canOpenUser) {
        return <span className="text-muted-foreground">-</span>;
    }

    return (
        <div className="grid max-w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2">
            <AffinityBadge
                isFriend={isFriend}
                isFavorite={isFavorite}
                iconOnly
            />
            <Button
                type="button"
                variant="ghost"
                className="hover:text-primary h-auto max-w-full min-w-0 justify-start p-0 text-left font-normal"
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
            </Button>
        </div>
    );
}

export function CopyInstanceWorldNameButton({
    worldName,
    variant = 'ghost'
}: {
    worldName: string;
    variant?: 'ghost' | 'outline';
}) {
    const { t } = useTranslation();
    const normalizedWorldName = worldName.trim();

    if (!normalizedWorldName) {
        return null;
    }

    const label = `${t('common.actions.copy')}: ${normalizedWorldName}`;

    return (
        <Button
            type="button"
            size="icon-xs"
            variant={variant}
            className="shrink-0"
            aria-label={label}
            title={label}
            onClick={() => {
                void copyTextToClipboard(normalizedWorldName, {
                    successMessage: t('dialog.world.dynamic.value_copied', {
                        value: t('dialog.world.info.name')
                    })
                });
            }}
        >
            <CopyIcon data-icon="icon" />
        </Button>
    );
}

function InstanceWorldCell({ row }: { row: PreviousInstanceRow | null }) {
    const worldId = rowWorldId(row);
    const worldName = row?.worldName || '';

    if (!worldId && !worldName) {
        return <span className="text-muted-foreground">-</span>;
    }

    return (
        <div className="flex min-w-0 items-center gap-1.5">
            {worldId ? (
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
            ) : (
                <span className="min-w-0 truncate">{worldName}</span>
            )}
            <CopyInstanceWorldNameButton worldName={worldName} />
        </div>
    );
}

export function PreviousInstanceDetailsPanel({
    row,
    onBack = null,
    showTitle = true,
    className = ''
}: {
    row: PreviousInstanceRow | null;
    onBack?: (() => void) | null;
    showTitle?: boolean;
    className?: string;
}) {
    const { t } = useTranslation();

    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const favoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavoritesList = useFavoriteStore(
        (state) => state.localFriendFavoritesList
    );
    const [detailsViewMode, setDetailsViewMode] = useState('players');
    const [infoData, setInfoData] = useState<{
        status: LoadStatus;
        error: string;
        players: PreviousInstancePlayerRow[];
        details: PreviousInstancePlayerRow[];
    }>({
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
    const favoriteIdSet = useMemo(
        () =>
            new Set([
                ...(favoriteFriendIds || []),
                ...(localFriendFavoritesList || [])
            ]),
        [favoriteFriendIds, localFriendFavoritesList]
    );
    const missingPlayerProfileIds = useMemo(() => {
        const ids = [];
        for (const userId of playerFactIds) {
            if (knownPlayersById[userId]?.displayName) {
                continue;
            }
            const row = [...infoData.players, ...infoData.details].find(
                (player) => playerUserId(player) === userId
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
        setInfoData((current) => ({
            ...current,
            status: 'running',
            error: ''
        }));

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
            .catch((error: unknown) => {
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

    const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
    useEffect(() => {
        if (!row || !rowLocation(row)) {
            setShowLoadingIndicator(false);
            return undefined;
        }
        setShowLoadingIndicator(false);
        const timer = window.setTimeout(() => {
            setShowLoadingIndicator(true);
        }, DETAILS_LOADING_INDICATOR_DELAY_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [row]);

    useEffect(() => {
        if (!missingPlayerProfileIds.length) {
            return;
        }

        Promise.allSettled(
            missingPlayerProfileIds.slice(0, 50).map((userId) =>
                userProfileRepository.getUserProfile({
                    userId
                })
            )
        ).catch(() => {});
    }, [currentEndpoint, missingPlayerProfileIds]);

    function resolvePlayerDisplayName(player: PreviousInstancePlayerRow) {
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
                                <PageDescription className="break-words">
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
                    {infoData.status === 'error' ? (
                        <DialogErrorState>{infoData.error}</DialogErrorState>
                    ) : (
                        <div className="relative min-h-0">
                            {infoData.status === 'running' &&
                            showLoadingIndicator ? (
                                <div className="bg-popover text-muted-foreground pointer-events-none absolute top-1 right-1 z-10 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shadow-sm">
                                    <Spinner className="size-3.5" />
                                    {t(
                                        'dialog.previous_instances.loading.loading_instance_details'
                                    )}
                                </div>
                            ) : null}
                            <div
                                className={cn(
                                    'min-h-0',
                                    infoData.status === 'running' &&
                                        'pointer-events-none opacity-60'
                                )}
                            >
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
                                                        (player, index) => (
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
                                                                        isFriend={Boolean(
                                                                            friendsById[
                                                                                playerUserId(
                                                                                    player
                                                                                )
                                                                            ]
                                                                        )}
                                                                        isFavorite={favoriteIdSet.has(
                                                                            playerUserId(
                                                                                player
                                                                            )
                                                                        )}
                                                                    />
                                                                </TableCell>
                                                                <TableCell className="align-top text-xs tabular-nums">
                                                                    {String(
                                                                        player?.count ||
                                                                            '-'
                                                                    )}
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
                                                ) : infoData.status ===
                                                  'running' ? null : (
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
                            </div>
                        </div>
                    )}
                </Tabs>
            </div>
        </div>
    );
}
