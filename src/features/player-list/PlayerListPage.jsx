import {
    getCoreRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { LoadingState, PageScaffold } from '@/components/layout/PageScaffold.jsx';
import { userImage } from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis.js';
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
import { openUserDialog } from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { resolvePlatformMeta } from './playerListDisplay.js';
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
import { appI18n } from '@/services/i18nService.js';
import { buildPlayerListColumns } from './components/PlayerListColumns.jsx';
import {
    CurrentWorldHeader,
    PlayerListEmptyState,
    PlayerListRows,
    PlayerListTableShell
} from './components/PlayerListViewParts.jsx';

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
                        'Failed to reconstruct current players for the current instance.'
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
                toast.info(t('view.player_list.generated.no_user_id_was_found_for_this_player_row'));
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
            toast.info(t('view.player_list.generated.no_user_id_was_found_for_this_player_row'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.player_list.generated_toast.failed_to_look_up_this_player')
            );
        }
    }

    const tableColumns = useMemo(
        () =>
            buildPlayerListColumns({
                isDarkMode,
                randomUserColours,
                t
            }),
        [isDarkMode, randomUserColours, t]
    );
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
                    <LoadingState label={t('view.player_list.generated.rebuilding_the_current_instance_roster_from_game_log_history')} />
                ) : isError ? (
                    <PlayerListEmptyState
                        title={t('view.player_list.generated.current_players_failed_to_load')}
                        description={userFacingErrorMessage(
                            detail,
                            'Current players could not be rebuilt for the current instance.'
                        )}
                    />
                ) : (
                    <PlayerListTableShell
                        table={table}
                        onResetLayout={resetPlayerListTableLayout}
                    >
                        <PlayerListRows
                            table={table}
                            hasRows={hasRows}
                            onOpenPlayer={openPlayerRow}
                            emptyTitle={
                                gameLogDisabled
                                    ? 'Game log is disabled'
                                    : !isGameRunning
                                      ? 'VRChat is not running'
                                      : isPlayerListSourceUnavailable
                                        ? 'Current players are not available yet'
                                        : parsedLocation.isTraveling
                                          ? 'Currently traveling between instances'
                                          : parsedLocation.isOffline
                                            ? 'No current instance detected'
                                            : 'No players reconstructed for this instance yet'
                            }
                            emptyDescription={
                                gameLogDisabled
                                    ? 'Enable game log ingestion in settings before current players can be reconstructed.'
                                    : !isGameRunning
                                      ? 'Start VRChat and let VRCX-0 receive game-log events before this page can rebuild the current instance.'
                                      : isPlayerListSourceUnavailable
                                        ? 'Stay in the instance until local join/leave events are recorded, then this table will populate automatically.'
                                        : parsedLocation.isTraveling
                                          ? 'Current players follow live instance locations. They will repopulate after the next location event lands.'
                                          : 'The local join/leave history does not have any current players for the active location yet.'
                            }
                        />
                    </PlayerListTableShell>
                )}
            </div>
        </PageScaffold>
    );
}
