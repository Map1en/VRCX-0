import {
    getCoreRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    ExternalLinkIcon,
    HomeIcon,
    IdCardIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import {
    DataTableHeader,
    DataTableEmptyRow,
    DataTableScrollArea,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import {
    EmptyState,
    LoadingState,
    PageScaffold
} from '@/components/layout/PageScaffold.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import {
    convertFileUrlToImageUrl,
    getNameColour,
    openExternalLink,
    userImage
} from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis.js';
import { cn } from '@/lib/utils.js';
import {
    defaultWorldCacheInfo,
    readWorldCacheInfo
} from '@/lib/worldAssetBundle.js';
import {
    gameLogRepository,
    playerListRepository,
    vrchatModerationRepository,
    vrchatAuthRepository,
    vrchatSearchRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { getFaviconUrl } from '@/shared/utils/urlUtils.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    fileAnalysisSizeForPlatform,
    formatCount,
    getHomeWorldId,
    getWorldImage,
    languageCodeLabel,
    resolvePlatformBadge,
    resolvePlatformMeta,
    resolvePlatformMode,
    resolveStatusMeta
} from './playerListDisplay.js';
import {
    buildFavoriteIdSet,
    buildPlayerSourceRows,
    normalizeString,
    parseTimeMs
} from './playerListRows.js';
import {
    PLAYER_LIST_COLUMN_IDS as COLUMN_IDS,
    readPersistedPlayerListState,
    sanitizePlayerListColumnOrder,
    sanitizePlayerListColumnSizing,
    sanitizePlayerListColumnVisibility,
    sanitizePlayerListSorting,
    writePersistedPlayerListState
} from './playerListState.js';

function CurrentWorldHeader({
    cacheInfo = defaultWorldCacheInfo(),
    clockNow,
    context,
    currentUserSnapshot,
    fileAnalysis = {},
    friendCount,
    isGameRunning,
    onPreviewImage,
    playerCount,
    parsedLocation,
    startedAt,
    t,
    world
}) {
    const worldId =
        world?.id || context.worldId || parsedLocation.worldId || '';
    const worldName = world?.name || context.worldName || 'Current instance';
    const homeWorldId = getHomeWorldId(
        currentUserSnapshot?.$homeLocation || currentUserSnapshot?.homeLocation
    );
    const isHome = Boolean(homeWorldId && worldId && homeWorldId === worldId);
    const imageUrl = getWorldImage(world);
    const platforms = Array.isArray(world?.platforms)
        ? world.platforms.map(resolvePlatformBadge)
        : [];
    const startedAtMs = parseTimeMs(startedAt || context.createdAt);
    const elapsedMs = startedAtMs ? Math.max(clockNow - startedAtMs, 0) : 0;
    const hasAvatarScalingDisabled = Array.isArray(world?.tags)
        ? world.tags.includes('feature_avatar_scaling_disabled')
        : false;
    const currentInstanceLocationObject = parseLocation(context.location || '');
    const worldDialogTarget =
        currentInstanceLocationObject.isRealInstance &&
        currentInstanceLocationObject.tag
            ? currentInstanceLocationObject.tag
            : worldId;

    if (!isGameRunning || !worldId) {
        return null;
    }

    return (
        <div className="flex min-h-28 flex-col gap-3 md:flex-row">
            <Button
                type="button"
                variant="ghost"
                className="bg-muted h-28 w-40 shrink-0 overflow-hidden rounded-md border p-0"
                disabled={!imageUrl}
                aria-label={worldName}
                onClick={() =>
                    imageUrl &&
                    onPreviewImage?.({
                        url: convertFileUrlToImageUrl(
                            world?.imageUrl || imageUrl,
                            1024
                        ),
                        title: worldName
                    })
                }
            >
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                    />
                ) : (
                    <UsersIcon
                        data-icon="inline-start"
                        className="text-muted-foreground"
                    />
                )}
            </Button>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div>
                    <Button
                        type="button"
                        variant="link"
                        className="h-auto max-w-full justify-start p-0 text-left text-base font-semibold"
                        onClick={() =>
                            openWorldDialog({
                                worldId: worldDialogTarget,
                                title: worldName
                            })
                        }
                    >
                        {isHome ? <HomeIcon data-icon="inline-start" /> : null}
                        <span className="truncate">{worldName}</span>
                    </Button>
                </div>
                {world?.authorName ? (
                    <Button
                        type="button"
                        variant="link"
                        className="text-muted-foreground h-auto justify-start p-0 font-mono text-xs"
                        onClick={() =>
                            world?.authorId &&
                            openUserDialog({
                                userId: world.authorId,
                                title: world.authorName || undefined
                            })
                        }
                    >
                        {world.authorName}
                    </Button>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                    {world?.isLabs ? (
                        <Badge variant="outline">
                            {t('dialog.world.tags.labs')}
                        </Badge>
                    ) : world?.releaseStatus === 'public' ? (
                        <Badge variant="outline">
                            {t('dialog.world.tags.public')}
                        </Badge>
                    ) : world?.releaseStatus === 'private' ? (
                        <Badge variant="outline">
                            {t('dialog.world.tags.private')}
                        </Badge>
                    ) : null}
                    {platforms.map((platform) => {
                        const Icon = platform.icon;
                        return (
                            <Badge
                                key={platform.key}
                                variant="outline"
                                className="gap-1"
                            >
                                {Icon ? <Icon className="size-3.5" /> : null}
                                {platform.label}
                                {fileAnalysisSizeForPlatform(
                                    fileAnalysis,
                                    platform.key
                                ) ? (
                                    <span className="border-l pl-1">
                                        {fileAnalysisSizeForPlatform(
                                            fileAnalysis,
                                            platform.key
                                        )}
                                    </span>
                                ) : null}
                            </Badge>
                        );
                    })}
                    {hasAvatarScalingDisabled ? (
                        <Badge variant="outline">
                            {t('dialog.world.tags.avatar_scaling_disabled')}
                        </Badge>
                    ) : null}
                    {cacheInfo?.inCache ? (
                        <Badge variant="outline">
                            {cacheInfo.cacheSize
                                ? `${cacheInfo.cacheSize} ${t('dialog.world.tags.cache')}`
                                : t('dialog.world.tags.cache')}
                        </Badge>
                    ) : null}
                    {context.groupName ? (
                        <Badge variant="outline">{context.groupName}</Badge>
                    ) : null}
                    {playerCount > 0 ? (
                        <Badge variant="outline">
                            {playerCount}
                            {friendCount > 0 ? ` (${friendCount})` : ''}
                            {' players'}
                        </Badge>
                    ) : null}
                    {elapsedMs > 0 ? (
                        <Badge variant="outline">
                            {timeToText(elapsedMs, true)}
                        </Badge>
                    ) : null}
                </div>
                <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 font-mono text-xs">
                    <LocationWorld
                        locationObject={currentInstanceLocationObject}
                        currentUserId={currentUserSnapshot?.id || ''}
                        grouphint={context.groupName || ''}
                        hint={worldName}
                        className="font-sans"
                    />
                </div>
                {world?.description && world.description !== worldName ? (
                    <div className="line-clamp-2 text-xs break-words">
                        {world.description}
                    </div>
                ) : null}
            </div>
            <div className="grid min-w-40 content-start gap-2 text-xs sm:grid-cols-3 md:grid-cols-1">
                <div>
                    <span className="text-muted-foreground block">
                        Capacity
                    </span>
                    <span className="font-medium">
                        {formatCount(
                            world?.recommendedCapacity || world?.capacity
                        )}
                        {world?.capacity
                            ? ` (${formatCount(world.capacity)})`
                            : ''}
                    </span>
                </div>
                <div>
                    <span className="text-muted-foreground block">
                        Last updated
                    </span>
                    <span className="font-medium">
                        {fileAnalysis?.standalonewindows?.created_at
                            ? formatDateFilter(
                                  fileAnalysis.standalonewindows.created_at,
                                  'long'
                              )
                            : world?.updatedAt
                              ? formatDateFilter(world.updatedAt, 'long')
                              : '-'}
                    </span>
                </div>
                <div>
                    <span className="text-muted-foreground block">Created</span>
                    <span className="font-medium">
                        {world?.createdAt
                            ? formatDateFilter(world.createdAt, 'long')
                            : '-'}
                    </span>
                </div>
            </div>
        </div>
    );
}
function SortButton({ column, label }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground h-auto justify-start gap-1 p-0 text-left text-xs font-medium tracking-wide uppercase"
            onClick={() => column.toggleSorting(direction === 'asc')}
        >
            <span>{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon data-icon="inline-end" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon data-icon="inline-end" />
            ) : (
                <ArrowUpDownIcon data-icon="inline-end" />
            )}
        </Button>
    );
}

function PlayerListTableShell({ table, onResetLayout, children }) {
    return (
        <DataTableSurface>
            <DataTableScrollArea>
                <Table className="app-data-table table-fixed">
                    <DataTableHeader
                        table={table}
                        onResetLayout={onResetLayout}
                    />
                    <TableBody>{children}</TableBody>
                </Table>
            </DataTableScrollArea>
        </DataTableSurface>
    );
}

function PlayerListEmptyRow({ table, title, description }) {
    const visibleColumnCount =
        table.getVisibleLeafColumns?.().length ||
        table.getAllLeafColumns?.().length ||
        COLUMN_IDS.length;
    return (
        <DataTableEmptyRow
            colSpan={Math.max(1, visibleColumnCount)}
            className="py-10"
        >
            <div className="mx-auto flex max-w-md flex-col gap-2">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-muted-foreground text-sm">
                    {description}
                </div>
            </div>
        </DataTableEmptyRow>
    );
}

function PlayerListEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}

export function PlayerListPage({ embedded = false } = {}) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentUserLocation = useRuntimeStore((state) => {
        const gameLocation = state.gameState.currentLocation;
        if (gameLocation === 'traveling') {
            return (
                state.gameState.currentDestination ||
                state.auth.currentUserSnapshot?.location ||
                ''
            );
        }
        return gameLocation || state.auth.currentUserSnapshot?.location || '';
    });
    const currentUserWorldId = useRuntimeStore(
        (state) =>
            parseLocation(state.gameState.currentLocation || '').worldId ||
            state.auth.currentUserSnapshot?.worldId ||
            ''
    );
    const currentLocationStartedAt = useRuntimeStore(
        (state) => state.gameState.currentLocationStartedAt
    );
    const isGameRunning = useRuntimeStore((state) =>
        Boolean(state.gameState.isGameRunning)
    );
    const addGameLogEventCount = useRuntimeStore(
        (state) => state.backendEvents.addGameLogEvent.count
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const gameLogDisabled = usePreferencesStore(
        (state) => state.gameLogDisabled
    );
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );

    const persistedState = useMemo(() => readPersistedPlayerListState(), []);
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);

    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [context, setContext] = useState({
        createdAt: '',
        location: '',
        worldId: '',
        worldName: '',
        time: 0,
        groupName: '',
        playerCount: 0,
        source: 'none'
    });
    const [playerRows, setPlayerRows] = useState([]);
    const [moderationByUserId, setModerationByUserId] = useState({});
    const [currentWorldProfile, setCurrentWorldProfile] = useState(null);
    const [currentWorldFileAnalysis, setCurrentWorldFileAnalysis] = useState(
        {}
    );
    const [currentWorldCacheInfo, setCurrentWorldCacheInfo] = useState(() =>
        defaultWorldCacheInfo()
    );
    const [clockNow, setClockNow] = useState(() => Date.now());
    const [sorting, setSorting] = useState(() =>
        sanitizePlayerListSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizePlayerListColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizePlayerListColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizePlayerListColumnSizing(persistedState.columnSizing)
    );
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );

    useEffect(() => {
        const timer = window.setInterval(() => {
            setClockNow(Date.now());
        }, 30000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }

        writePersistedPlayerListState({
            sorting: sanitizePlayerListSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }

        writePersistedPlayerListState({
            columnVisibility:
                sanitizePlayerListColumnVisibility(columnVisibility),
            columnOrder: sanitizePlayerListColumnOrder(columnOrder),
            columnSizing: sanitizePlayerListColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing, columnVisibility]);

    useEffect(() => {
        let active = true;

        if (gameLogDisabled) {
            setLoadStatus('idle');
            setDetail('Game log ingestion is disabled.');
            setContext({
                createdAt: '',
                location: currentUserLocation || '',
                worldId: currentUserWorldId || '',
                worldName: '',
                time: 0,
                groupName: '',
                playerCount: 0,
                source: 'runtime'
            });
            setPlayerRows([]);
            return () => {
                active = false;
            };
        }

        if (!isGameRunning) {
            setLoadStatus('idle');
            setDetail('');
            setContext({
                createdAt: '',
                location: currentUserLocation || '',
                worldId: currentUserWorldId || '',
                worldName: '',
                time: 0,
                groupName: '',
                playerCount: 0,
                source: 'runtime'
            });
            setPlayerRows([]);
            return () => {
                active = false;
            };
        }

        if (!currentUserLocation) {
            setLoadStatus('idle');
            setDetail('Waiting for the current runtime location.');
            setContext({
                createdAt: '',
                location: '',
                worldId: currentUserWorldId || '',
                worldName: '',
                time: 0,
                groupName: '',
                playerCount: 0,
                source: 'runtime'
            });
            setPlayerRows([]);
            return () => {
                active = false;
            };
        }

        setLoadStatus('running');
        setDetail('');

        playerListRepository
            .getCurrentInstanceSnapshot({
                currentUserId,
                currentLocation: currentUserLocation
            })
            .then((result) => {
                if (!active) {
                    return;
                }

                setContext(result.context);
                setPlayerRows(result.players);
                setLoadStatus('ready');
                setDetail(
                    result.context.source === 'database'
                        ? 'Rebuilt the current instance roster from local join/leave history.'
                        : 'Using the current runtime location while waiting for more local game-log history.'
                );
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                setLoadStatus('error');
                setPlayerRows([]);
                setDetail(
                    userFacingErrorMessage(
                        error,
                        'Failed to reconstruct the current instance player list.'
                    )
                );
            });

        return () => {
            active = false;
        };
    }, [
        addGameLogEventCount,
        currentUserId,
        currentUserLocation,
        currentUserWorldId,
        gameLogDisabled,
        isGameRunning
    ]);

    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );

    const playerSourceRows = useMemo(() => {
        return buildPlayerSourceRows({
            playerRows,
            currentUserId,
            currentUserSnapshot,
            isGameRunning,
            context,
            currentUserLocation,
            currentLocationStartedAt
        });
    }, [
        context.createdAt,
        context.location,
        currentLocationStartedAt,
        currentUserId,
        currentUserLocation,
        currentUserSnapshot,
        isGameRunning,
        playerRows
    ]);

    const enrichedRows = useMemo(() => {
        return playerSourceRows.map((row) => {
            const normalizedUserId = normalizeString(row.userId);
            const friend = normalizedUserId
                ? friendsById[normalizedUserId]
                : null;
            const moderation = normalizedUserId
                ? moderationByUserId[normalizedUserId]
                : null;
            const isCurrentUser =
                normalizedUserId &&
                normalizedUserId === normalizeString(currentUserId);
            const userRef = isCurrentUser
                ? currentUserSnapshot
                : friend || row.ref || null;
            const resolvedDisplayName =
                row.displayName ||
                userRef?.displayName ||
                userRef?.username ||
                normalizedUserId ||
                '';
            const trustLevel = userRef?.$trustLevel || '';
            const trustSortNum =
                Number.parseInt(userRef?.$trustSortNum ?? 0, 10) || 0;
            const platform =
                userRef?.$platform ||
                userRef?.platform ||
                userRef?.last_platform ||
                '';
            const platformMeta = resolvePlatformMeta(platform);
            const statusDescription = userRef?.statusDescription || '';
            const languages = Array.isArray(userRef?.$languages)
                ? userRef.$languages
                : [];
            const bioLinks = Array.isArray(userRef?.bioLinks)
                ? userRef.bioLinks.filter(Boolean)
                : [];
            const note =
                typeof userRef?.note === 'string'
                    ? userRef.note
                    : typeof userRef?.memo === 'string'
                      ? userRef.memo
                      : '';
            const isFavorite = normalizedUserId
                ? favoriteFriendIds.has(normalizedUserId)
                : false;
            const isBlocked = Boolean(moderation?.block);
            const isMuted = Boolean(moderation?.mute);
            const isAvatarInteractionDisabled = Boolean(
                userRef?.$moderations?.isAvatarInteractionDisabled ||
                userRef?.moderations?.isAvatarInteractionDisabled ||
                moderation?.isAvatarInteractionDisabled
            );
            const isChatBoxMuted = Boolean(
                row.isChatBoxMuted ||
                userRef?.isChatBoxMuted ||
                userRef?.$moderations?.isChatBoxMuted ||
                userRef?.moderations?.isChatBoxMuted ||
                moderation?.isChatBoxMuted
            );
            const timeoutTime =
                Number(
                    row.timeoutTime ??
                        userRef?.timeoutTime ??
                        userRef?.$moderations?.timeoutTime ??
                        userRef?.moderations?.timeoutTime ??
                        moderation?.timeoutTime ??
                        0
                ) || 0;
            const ageVerified = Boolean(userRef?.ageVerified);
            const joinedAtTime = parseTimeMs(row.joinedAt || row.joinedAtMs);
            const iconWeight =
                (isCurrentUser ? 1000 : 0) +
                (row.isMaster ? 1000 : 0) +
                (row.isModerator ? 500 : 0) +
                (isFavorite ? 500 : 0) +
                (friend ? 250 : 0) -
                (isBlocked ? 100 : 0) -
                (isMuted ? 50 : 0) -
                (isAvatarInteractionDisabled ? 20 : 0) +
                (isChatBoxMuted ? -10 : 0) +
                (timeoutTime ? -5 : 0) +
                (ageVerified ? 5 : 0);

            return {
                ...row,
                displayName: resolvedDisplayName,
                userId: normalizedUserId,
                userRef,
                trustLevel,
                trustSortNum,
                trustClass: userRef?.$trustClass || '',
                platformLabel: platformMeta.label,
                platformIcon: platformMeta.icon,
                platformClassName: platformMeta.className,
                inVRMode: row.inVRMode,
                status: userRef?.status || '',
                statusDescription,
                languages,
                bioLinks,
                note,
                avatarUrl: userImage(userRef, true),
                isCurrentUser: Boolean(isCurrentUser),
                isFriend: Boolean(friend),
                isFavorite,
                isBlocked,
                isMuted,
                isAvatarInteractionDisabled,
                isChatBoxMuted,
                timeoutTime,
                ageVerified,
                iconWeight,
                timerMs:
                    joinedAtTime > 0 ? Math.max(clockNow - joinedAtTime, 0) : 0,
                worldName: context.worldName,
                location: context.location
            };
        });
    }, [
        clockNow,
        context.location,
        context.worldName,
        currentUserId,
        currentUserSnapshot,
        favoriteFriendIds,
        friendsById,
        moderationByUserId,
        playerSourceRows
    ]);

    const filteredRows = isGameRunning ? enrichedRows : [];
    const headerPlayerCount = isGameRunning
        ? filteredRows.length || Number(context.playerCount) || 0
        : 0;
    const headerFriendCount = filteredRows.reduce(
        (total, row) => total + (row.isFriend ? 1 : 0),
        0
    );

    const parsedLocation = useMemo(
        () => parseLocation(context.location || currentUserLocation || ''),
        [context.location, currentUserLocation]
    );
    const isPlayerListSourceUnavailable = Boolean(
        !gameLogDisabled &&
        isGameRunning &&
        loadStatus === 'ready' &&
        context.source !== 'database' &&
        playerSourceRows.length === 0 &&
        !parsedLocation.isTraveling &&
        !parsedLocation.isOffline
    );

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            setModerationByUserId({});
            return () => {
                active = false;
            };
        }

        vrchatModerationRepository
            .getAllLocalModerations(currentUserId)
            .then((rows) => {
                if (!active) {
                    return;
                }

                setModerationByUserId(
                    Object.fromEntries(
                        (Array.isArray(rows) ? rows : [])
                            .filter((row) => normalizeString(row?.userId))
                            .map((row) => [normalizeString(row.userId), row])
                    )
                );
            })
            .catch(() => {
                if (active) {
                    setModerationByUserId({});
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserId]);

    useEffect(() => {
        let active = true;
        const worldId = parsedLocation.worldId || context.worldId || '';

        if (!isGameRunning || !worldId) {
            setCurrentWorldProfile(null);
            setCurrentWorldFileAnalysis({});
            setCurrentWorldCacheInfo(defaultWorldCacheInfo());
            return () => {
                active = false;
            };
        }

        worldProfileRepository
            .getWorldProfile({
                worldId,
                endpoint: currentUserEndpoint
            })
            .then((world) => {
                if (active) {
                    setCurrentWorldProfile(world);
                }
                return vrchatAuthRepository
                    .getConfig({ endpoint: currentUserEndpoint })
                    .catch(() => null)
                    .then((configResponse) => {
                        const sdkUnityVersion = String(
                            configResponse?.json?.sdkUnityVersion || ''
                        );
                        return Promise.all([
                            getFileAnalysisForUnityPackages({
                                unityPackages: world?.unityPackages,
                                sdkUnityVersion,
                                endpoint: currentUserEndpoint
                            }),
                            readWorldCacheInfo(
                                world,
                                currentUserEndpoint,
                                sdkUnityVersion
                            )
                        ]);
                    });
            })
            .then(([fileAnalysis, cacheInfo]) => {
                if (active) {
                    setCurrentWorldFileAnalysis(fileAnalysis || {});
                    setCurrentWorldCacheInfo(
                        cacheInfo || defaultWorldCacheInfo()
                    );
                }
            })
            .catch(() => {
                if (active) {
                    setCurrentWorldProfile(null);
                    setCurrentWorldFileAnalysis({});
                    setCurrentWorldCacheInfo(defaultWorldCacheInfo());
                }
            });

        return () => {
            active = false;
        };
    }, [
        context.worldId,
        currentUserEndpoint,
        isGameRunning,
        parsedLocation.worldId
    ]);

    const isDarkMode =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');

    async function openPlayerRow(row) {
        const userId = normalizeString(
            row?.userId || row?.userRef?.id || row?.ref?.id
        );
        const displayName = normalizeString(
            row?.displayName ||
                row?.userRef?.displayName ||
                row?.ref?.displayName
        );

        if (userId) {
            openUserDialog({ userId, title: displayName });
            return;
        }

        if (!displayName || displayName.startsWith('ID:')) {
            return;
        }

        try {
            const lowerDisplayName = displayName.toLowerCase();
            const localUser = [
                currentUserSnapshot,
                ...Object.values(friendsById || {})
            ].find((user) => {
                const name = normalizeString(
                    user?.displayName || user?.username
                ).toLowerCase();
                return name && name === lowerDisplayName;
            });
            if (localUser?.id) {
                openUserDialog({
                    userId: localUser.id,
                    title: localUser.displayName || displayName,
                    seedData: localUser
                });
                return;
            }

            const cachedUserId = normalizeString(
                await gameLogRepository
                    .getUserIdFromDisplayName(displayName)
                    .catch(() => '')
            );
            if (cachedUserId) {
                openUserDialog({
                    userId: cachedUserId,
                    title: displayName
                });
                return;
            }

            const candidates = [
                displayName,
                normalizeString(row?.userRef?.displayName),
                normalizeString(row?.ref?.displayName),
                normalizeString(row?.id)
            ].filter(Boolean);
            if (!candidates.length) {
                toast.info('No user id was found for this player row.');
                return;
            }
            const response = await vrchatSearchRepository.getUsers({
                search: candidates[0],
                n: 5,
                offset: 0
            });
            const rows = Array.isArray(response.json) ? response.json : [];
            const match = rows.find((user) =>
                candidates.some(
                    (candidate) =>
                        normalizeString(user?.id) === candidate ||
                        normalizeString(user?.displayName).toLowerCase() ===
                            candidate.toLowerCase()
                )
            );
            if (match?.id) {
                openUserDialog({
                    userId: match.id,
                    title: match.displayName || displayName,
                    seedData: match
                });
                return;
            }
            toast.info('No user id was found for this player row.');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to look up this player.'
            );
        }
    }

    const tableColumns = useMemo(() => {
        return [
            {
                id: 'avatar',
                size: 72,
                meta: { label: t('table.playerList.avatar') },
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.playerList.avatar')}
                    </span>
                ),
                accessorFn: (row) => row.avatarUrl,
                enableSorting: false,
                cell: ({ row }) =>
                    row.original.avatarUrl ? (
                        <img
                            src={row.original.avatarUrl}
                            alt={row.original.displayName || 'Player avatar'}
                            loading="lazy"
                            className="size-4 rounded-sm object-cover"
                        />
                    ) : (
                        <span className="bg-muted flex size-4 items-center justify-center rounded-sm">
                            <UserIcon className="text-muted-foreground size-3" />
                        </span>
                    )
            },
            {
                id: 'timer',
                size: 96,
                meta: { label: t('table.playerList.timer') },
                accessorFn: (row) => row.timerMs,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.timer')}
                    />
                ),
                cell: ({ row }) => (
                    <span className="text-sm">
                        {row.original.joinedAtMs > 0
                            ? timeToText(row.original.timerMs, true)
                            : ''}
                    </span>
                )
            },
            {
                id: 'displayName',
                size: 280,
                meta: { label: t('table.playerList.displayName') },
                accessorFn: (row) => row.displayName,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.displayName')}
                    />
                ),
                sortingFn: (rowA, rowB) =>
                    String(rowA.original?.displayName || '').localeCompare(
                        String(rowB.original?.displayName || ''),
                        undefined,
                        { sensitivity: 'base' }
                    ),
                cell: ({ row }) => {
                    const style =
                        randomUserColours && row.original?.userId
                            ? {
                                  color: getNameColour(
                                      row.original.userId,
                                      isDarkMode
                                  )
                              }
                            : undefined;

                    return (
                        <span
                            className="block min-w-0 truncate text-sm"
                            style={style}
                        >
                            {row.original.displayName}
                        </span>
                    );
                }
            },
            {
                id: 'rank',
                size: 120,
                meta: { label: t('table.playerList.rank') },
                accessorFn: (row) => row.trustSortNum,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.rank')}
                    />
                ),
                cell: ({ row }) => (
                    <span
                        className={cn('text-sm', row.original.trustClass || '')}
                    >
                        {row.original.trustLevel || ''}
                    </span>
                )
            },
            {
                id: 'status',
                size: 220,
                meta: { label: t('table.playerList.status') },
                accessorFn: (row) => resolveStatusMeta(row).label,
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.playerList.status')}
                    </span>
                ),
                enableSorting: false,
                cell: ({ row }) => {
                    const status = resolveStatusMeta(row.original);

                    return (
                        <span className="flex w-full min-w-0 items-center gap-2">
                            {status.indicatorClassName ? (
                                <i className={status.indicatorClassName} />
                            ) : null}
                            <span className="min-w-0 truncate text-sm">
                                {status.label}
                            </span>
                        </span>
                    );
                }
            },
            {
                id: 'icon',
                size: 140,
                meta: { label: t('table.playerList.icon') },
                accessorFn: (row) => row.iconWeight,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.icon')}
                    />
                ),
                cell: ({ row }) => (
                    <div className="flex items-center justify-center gap-1">
                        {row.original.isMaster ? (
                            <span title="Instance Master">👑</span>
                        ) : null}
                        {row.original.isModerator ? (
                            <span title="Moderator">⚔️</span>
                        ) : null}
                        {row.original.isFavorite ? (
                            <span title="Favorite">⭐</span>
                        ) : null}
                        {!row.original.isFavorite && row.original.isFriend ? (
                            <span title="Friend">💚</span>
                        ) : null}
                        {row.original.isBlocked ? (
                            <span className="text-destructive" title="Blocked">
                                ⛔
                            </span>
                        ) : null}
                        {row.original.isMuted ? (
                            <span
                                className="text-muted-foreground"
                                title="Muted"
                            >
                                🔇
                            </span>
                        ) : null}
                        {row.original.isAvatarInteractionDisabled ? (
                            <span
                                className="text-muted-foreground"
                                title="Avatar interaction disabled"
                            >
                                🚫
                            </span>
                        ) : null}
                        {row.original.isChatBoxMuted ? (
                            <span
                                className="text-muted-foreground"
                                title="Chatbox muted"
                            >
                                💬
                            </span>
                        ) : null}
                        {row.original.timeoutTime ? (
                            <span className="text-destructive" title="Timeout">
                                🔴{row.original.timeoutTime}s
                            </span>
                        ) : null}
                        {row.original.ageVerified ? (
                            <IdCardIcon
                                className="x-tag-age-verification size-4"
                                title="Age verified"
                            />
                        ) : null}
                    </div>
                )
            },
            {
                id: 'platform',
                size: 120,
                meta: { label: t('table.playerList.platform') },
                accessorFn: (row) => row.platformLabel,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.platform')}
                    />
                ),
                cell: ({ row }) => {
                    const Icon = row.original.platformIcon;
                    const mode = resolvePlatformMode(row.original);

                    return (
                        <div
                            className={cn(
                                'flex items-center gap-2 text-sm',
                                row.original.platformClassName
                            )}
                        >
                            {Icon ? <Icon className="size-4" /> : null}
                            {!Icon ? (
                                <span>{row.original.platformLabel}</span>
                            ) : null}
                            {mode ? (
                                <span className="text-muted-foreground">
                                    {mode}
                                </span>
                            ) : null}
                        </div>
                    );
                }
            },
            {
                id: 'language',
                size: 120,
                meta: { label: t('table.playerList.language') },
                accessorFn: (row) =>
                    row.languages
                        .map((entry) => entry?.value || entry?.key || '')
                        .join('\u0000'),
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.playerList.language')}
                    </span>
                ),
                enableSorting: false,
                cell: ({ row }) => (
                    <div className="flex flex-wrap items-center gap-1">
                        {row.original.languages.length
                            ? row.original.languages.map((entry) => {
                                  const key = entry?.key || entry?.value || '';
                                  const code = languageCodeLabel(key);
                                  if (!code) {
                                      return null;
                                  }
                                  return (
                                      <Tooltip
                                          key={`${key}:${entry?.value || ''}`}
                                      >
                                          <TooltipTrigger asChild>
                                              <span className="border-border/70 bg-muted/70 text-muted-foreground inline-flex h-5 min-w-8 items-center justify-center rounded border px-1 font-mono text-[10px] leading-none font-semibold">
                                                  {code}
                                              </span>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                              {code}
                                          </TooltipContent>
                                      </Tooltip>
                                  );
                              })
                            : null}
                    </div>
                )
            },
            {
                id: 'bioLink',
                size: 120,
                meta: { label: t('table.playerList.bioLink') },
                accessorFn: (row) => row.bioLinks.join('\u0000'),
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.playerList.bioLink')}
                    </span>
                ),
                enableSorting: false,
                cell: ({ row }) => (
                    <div className="flex items-center gap-1">
                        {row.original.bioLinks.length
                            ? row.original.bioLinks.map((link, index) => (
                                  <Button
                                      key={`${link}:${index}`}
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`${t('common.actions.open_link')}: ${link}`}
                                      title={link}
                                      onClick={(event) => {
                                          event.stopPropagation();
                                          void openExternalLink(link);
                                      }}
                                  >
                                      {getFaviconUrl(link) ? (
                                          <img
                                              src={getFaviconUrl(link)}
                                              alt=""
                                              className="size-4"
                                          />
                                      ) : (
                                          <ExternalLinkIcon data-icon="inline-start" />
                                      )}
                                  </Button>
                              ))
                            : null}
                    </div>
                )
            },
            {
                id: 'note',
                size: 180,
                meta: { label: t('table.playerList.note') },
                accessorFn: (row) => row.note || '',
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.playerList.note')}
                    </span>
                ),
                enableSorting: false,
                cell: ({ row }) => (
                    <span className="block truncate text-sm">
                        {row.original.note || ''}
                    </span>
                )
            }
        ];
    }, [isDarkMode, randomUserColours, t]);

    const table = useReactTable({
        data: filteredRows,
        columns: tableColumns,
        state: {
            columnOrder,
            columnSizing,
            columnVisibility,
            sorting
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getRowId: (row) =>
            `${row?.userId || row?.id || ''}:${row?.displayName || ''}`,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked,
            setColumnOrderLocked
        }
    });

    function resetPlayerListTableLayout() {
        setColumnVisibility({});
        setColumnOrder([...COLUMN_IDS]);
        setColumnSizing({});
    }

    const hasRows = filteredRows.length > 0;
    const isLoading = loadStatus === 'running' && playerSourceRows.length === 0;
    const isError = loadStatus === 'error' && playerSourceRows.length === 0;

    return (
        <PageScaffold
            embedded={embedded}
            className="overflow-x-hidden overflow-y-auto"
        >
            <CurrentWorldHeader
                cacheInfo={currentWorldCacheInfo}
                clockNow={clockNow}
                context={context}
                currentUserSnapshot={currentUserSnapshot}
                fileAnalysis={currentWorldFileAnalysis}
                friendCount={headerFriendCount}
                isGameRunning={isGameRunning}
                onPreviewImage={openImagePreview}
                playerCount={headerPlayerCount}
                parsedLocation={parsedLocation}
                startedAt={currentLocationStartedAt}
                t={t}
                world={currentWorldProfile}
            />

            <div className="current-instance-table flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="mb-2 flex justify-end">
                    <TableColumnVisibilityMenu
                        table={table}
                        onResetLayout={resetPlayerListTableLayout}
                    />
                </div>
                {isLoading ? (
                    <LoadingState label="Rebuilding the current instance roster from game-log history" />
                ) : isError ? (
                    <PlayerListEmptyState
                        title="Player list failed to load"
                        description={userFacingErrorMessage(
                            detail,
                            'The player-list adapter could not rebuild the current instance.'
                        )}
                    />
                ) : (
                    <PlayerListTableShell
                        table={table}
                        onResetLayout={resetPlayerListTableLayout}
                    >
                        {hasRows ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    className="cursor-pointer"
                                    tabIndex={0}
                                    aria-label={`Open ${row.original?.displayName || row.original?.userId || 'player'}`}
                                    onKeyDown={(event) => {
                                        if (
                                            event.key !== 'Enter' &&
                                            event.key !== ' '
                                        ) {
                                            return;
                                        }
                                        event.preventDefault();
                                        void openPlayerRow(row.original);
                                    }}
                                    onClick={() =>
                                        void openPlayerRow(row.original)
                                    }
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <ResizableTableCell
                                            key={cell.id}
                                            cell={cell}
                                        />
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <PlayerListEmptyRow
                                table={table}
                                title={
                                    gameLogDisabled
                                        ? 'Game log is disabled'
                                        : !isGameRunning
                                          ? 'VRChat is not running'
                                          : isPlayerListSourceUnavailable
                                            ? 'Player list is not available yet'
                                            : parsedLocation.isTraveling
                                              ? 'Currently traveling between instances'
                                              : parsedLocation.isOffline
                                                ? 'No current instance detected'
                                                : 'No players reconstructed for this instance yet'
                                }
                                description={
                                    gameLogDisabled
                                        ? 'Enable game log ingestion in settings before the current instance player list can be reconstructed.'
                                        : !isGameRunning
                                          ? 'Start VRChat and let VRCX receive game-log events before this page can rebuild the current instance.'
                                          : isPlayerListSourceUnavailable
                                            ? 'Stay in the instance until local join/leave events are recorded, then this table will populate automatically.'
                                            : parsedLocation.isTraveling
                                              ? 'The player list follows live instance locations. It will repopulate after the next location event lands.'
                                              : 'The local join/leave history does not have any current players for the active location yet.'
                                }
                            />
                        )}
                    </PlayerListTableShell>
                )}
            </div>
        </PageScaffold>
    );
}
