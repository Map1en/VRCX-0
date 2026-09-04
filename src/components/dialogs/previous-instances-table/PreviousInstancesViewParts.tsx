import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { CopyIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AffinityBadge } from '@/components/affinity/AffinityBadge';
import {
    DATA_TABLE_NUMERIC_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_HEADER_CLASS_NAME,
    DataTableCell,
    DataTableHead,
    DataTableHeaderRow,
    DataTableRow
} from '@/components/data-table/DataTableView';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import {
    PageBackButton,
    PageDescription,
    PageHeader,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { Location } from '@/components/Location';
import type { LoadStatus } from '@/domain/shared/types';
import {
    formatClock,
    formatCompactDateTime,
    formatDateFilterOrFallback,
    timeToText
} from '@/lib/dateTime';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import { useKnownUserFact, useKnownUserFacts } from '@/lib/useKnownUser';
import { cn } from '@/lib/utils';
import gameLogRepository from '@/repositories/gameLogRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import { openUserDialog } from '@/services/dialogService';
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
import { Table, TableBody, TableHeader } from '@/ui/shadcn/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { PreviousInstanceInfoChart } from './PreviousInstanceInfoChart';
import {
    createdTime,
    normalizePlayerRows,
    playerJoinMs,
    playerLeaveMs,
    playerDisplayName,
    playerUserId,
    previousInstanceVisitWindow,
    rowDuration,
    rowLocation,
    rowOwnerUserId
} from './previousInstancesRows';
import type {
    PreviousInstanceKnownUser,
    PreviousInstancePlayerRow,
    PreviousInstanceRow
} from './previousInstancesRows';

const DETAILS_LOADING_INDICATOR_DELAY_MS = 150;

type PreviousInstancePlayerClockRow = Parameters<typeof playerJoinMs>[0];

function isSameLocalDay(leftMs: number, rightMs: number) {
    const left = new Date(leftMs);
    const right = new Date(rightMs);
    return (
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate()
    );
}

function playerTimestampText(timestampMs: number, instanceStartMs: number) {
    if (!timestampMs) {
        return '—';
    }
    if (instanceStartMs && isSameLocalDay(timestampMs, instanceStartMs)) {
        return formatClock(timestampMs) || '—';
    }
    return formatCompactDateTime(timestampMs) || '—';
}

function playerJoinTimestamp(
    player: PreviousInstancePlayerClockRow,
    instanceStartMs: number
) {
    return playerTimestampText(playerJoinMs(player), instanceStartMs);
}

function playerLeaveTimestamp(
    player: PreviousInstancePlayerClockRow,
    instanceStartMs: number
) {
    return playerTimestampText(playerLeaveMs(player), instanceStartMs);
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

    const label = t('dialog.previous_instances.action.copy_world_name');

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        size="icon-xs"
                        variant={variant}
                        className="shrink-0"
                        aria-label={`${label}: ${normalizedWorldName}`}
                        onClick={() => {
                            void copyTextToClipboard(normalizedWorldName, {
                                successMessage: t(
                                    'dialog.world.dynamic.value_copied',
                                    {
                                        value: t('dialog.world.info.name')
                                    }
                                )
                            });
                        }}
                    >
                        <CopyIcon data-icon="icon" />
                    </Button>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function InstanceSummaryHeading({
    row,
    endpoint
}: {
    row: PreviousInstanceRow | null;
    endpoint: string;
}) {
    const { t } = useTranslation();
    const location = rowLocation(row);

    if (!location) {
        return (
            <PageDescription className="break-words">
                {instanceDetailsSummary(row, t)}
            </PageDescription>
        );
    }

    return (
        <div className="text-muted-foreground min-w-0 text-sm">
            <Location
                location={location}
                hint={row?.worldName || ''}
                endpoint={endpoint}
                showInstanceIdInLocation
                className="max-w-full"
            />
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
    const instanceStartMs = createdTime(row);
    const visitWindow = previousInstanceVisitWindow(row);
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
                className={cn('border-0', className)}
            />
        );
    }

    return (
        <div className={cn('flex min-h-0 flex-col overflow-hidden', className)}>
            <PageToolbar>
                <PageToolbarRow className="items-center">
                    {onBack ? (
                        <PageBackButton
                            label={t('common.actions.back')}
                            onClick={onBack}
                        />
                    ) : null}
                    {showTitle ? (
                        <PageHeader className="min-w-0 flex-1 p-0">
                            <PageTitle>
                                {t('dialog.previous_instances.info')}
                            </PageTitle>
                            <InstanceSummaryHeading
                                row={row}
                                endpoint={currentEndpoint}
                            />
                        </PageHeader>
                    ) : null}
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                        <CopyInstanceWorldNameButton
                            worldName={row?.worldName || ''}
                        />
                        <InstanceActionBar
                            target={{
                                location: rowLocation(row),
                                worldName: row?.worldName || ''
                            }}
                            showRefresh={false}
                            showInstanceInfo={false}
                        />
                    </div>
                </PageToolbarRow>
            </PageToolbar>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                <dl className="flex shrink-0 flex-wrap gap-x-10 gap-y-3 text-sm">
                    <div className="min-w-0">
                        <dt className="text-muted-foreground text-xs">
                            {t('table.previous_instances.date')}
                        </dt>
                        <dd className="mt-1 truncate font-medium tabular-nums">
                            {formatDateFilterOrFallback(
                                row?.created_at || row?.createdAt,
                                'long',
                                { empty: '—', invalid: '—' }
                            )}
                        </dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="text-muted-foreground text-xs">
                            {t('table.previous_instances.time')}
                        </dt>
                        <dd className="mt-1 font-medium tabular-nums">
                            {rowDuration(row)}
                        </dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="text-muted-foreground text-xs">
                            {t('table.previous_instances.instance_creator')}
                        </dt>
                        <dd className="mt-1 min-w-0 font-medium">
                            {rowOwnerUserId(row) ? (
                                <InstanceOwnerCell
                                    userId={rowOwnerUserId(row)}
                                    endpoint={currentEndpoint}
                                />
                            ) : (
                                <span className="text-muted-foreground">
                                    {'—'}
                                </span>
                            )}
                        </dd>
                    </div>
                </dl>
                <Tabs
                    value={detailsViewMode}
                    onValueChange={setDetailsViewMode}
                    className="min-h-0 shrink-0 gap-0"
                >
                    <div className="flex shrink-0 items-center justify-between gap-3">
                        <TabsList variant="underline">
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
                                    className="max-h-[32vh] min-h-0 overflow-auto pt-2"
                                >
                                    <div className="app-data-table vrcx-0-data-table min-h-0">
                                        <Table>
                                            <TableHeader className="vrcx-0-table-header sticky top-0">
                                                <DataTableHeaderRow>
                                                    <DataTableHead>
                                                        {t(
                                                            'table.previous_instances.display_name'
                                                        )}
                                                    </DataTableHead>
                                                    <DataTableHead
                                                        className={`w-20 ${DATA_TABLE_NUMERIC_HEADER_CLASS_NAME}`}
                                                    >
                                                        {t(
                                                            'dialog.world.info.visits'
                                                        )}
                                                    </DataTableHead>
                                                    <DataTableHead className="w-32">
                                                        {t(
                                                            'table.previous_instances.joined'
                                                        )}
                                                    </DataTableHead>
                                                    <DataTableHead className="w-32">
                                                        {t(
                                                            'table.previous_instances.left'
                                                        )}
                                                    </DataTableHead>
                                                    <DataTableHead
                                                        className={`w-28 ${DATA_TABLE_NUMERIC_HEADER_CLASS_NAME}`}
                                                    >
                                                        {t(
                                                            'table.previous_instances.time'
                                                        )}
                                                    </DataTableHead>
                                                </DataTableHeaderRow>
                                            </TableHeader>
                                            <TableBody>
                                                {infoData.players.length ? (
                                                    infoData.players.map(
                                                        (player, index) => (
                                                            <DataTableRow
                                                                key={`${playerDisplayName(player)}:${playerUserId(player)}:${index}`}
                                                            >
                                                                <DataTableCell className="align-top">
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
                                                                </DataTableCell>
                                                                <DataTableCell
                                                                    className={`${DATA_TABLE_NUMERIC_CELL_CLASS_NAME} align-top text-xs`}
                                                                >
                                                                    {String(
                                                                        player?.count ||
                                                                            '-'
                                                                    )}
                                                                </DataTableCell>
                                                                <DataTableCell className="text-muted-foreground align-top text-xs tabular-nums">
                                                                    {playerJoinTimestamp(
                                                                        player,
                                                                        instanceStartMs
                                                                    )}
                                                                </DataTableCell>
                                                                <DataTableCell className="text-muted-foreground align-top text-xs tabular-nums">
                                                                    {playerLeaveTimestamp(
                                                                        player,
                                                                        instanceStartMs
                                                                    )}
                                                                </DataTableCell>
                                                                <DataTableCell
                                                                    className={`${DATA_TABLE_NUMERIC_CELL_CLASS_NAME} align-top text-xs`}
                                                                >
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
                                                                </DataTableCell>
                                                            </DataTableRow>
                                                        )
                                                    )
                                                ) : infoData.status ===
                                                  'running' ? null : (
                                                    <DataTableRow>
                                                        <DataTableCell
                                                            colSpan={5}
                                                            className="py-6 text-center"
                                                        >
                                                            {t(
                                                                'dialog.previous_instances.empty.no_player_detail_rows_for_this_instance'
                                                            )}
                                                        </DataTableCell>
                                                    </DataTableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </TabsContent>
                                <TabsContent
                                    value="timeline"
                                    className="max-h-[52vh] min-h-0 overflow-auto pt-2"
                                >
                                    <PreviousInstanceInfoChart
                                        rows={infoData.details}
                                        visitWindow={visitWindow}
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
