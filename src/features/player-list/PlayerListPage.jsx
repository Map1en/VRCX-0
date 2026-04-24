import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PageScaffold } from '@/components/layout/PageScaffold.jsx';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    gameLogRepository,
    instanceRepository,
    playerListRepository,
    vrchatSearchRepository,
    vrchatModerationRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { PlayerListTableSection } from './components/PlayerListTableSection.jsx';
import { PlayerListWorldHeader } from './components/PlayerListWorldHeader.jsx';
import { enrichPlayerListRows } from './playerListEnrichment.js';
import {
    buildFavoriteIdSet,
    buildPlayerSourceRows,
    normalizeString
} from './playerListRows.js';

function normalizeApiInstanceUsers(...sources) {
    const rows = [];
    const seen = new Set();

    const push = (value) => {
        if (!value) {
            return;
        }
        if (value instanceof Map) {
            for (const entry of value.values()) {
                push(entry);
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const entry of value) {
                push(entry);
            }
            return;
        }
        if (typeof value === 'string') {
            const userId = normalizeString(value);
            if (userId && !seen.has(userId)) {
                seen.add(userId);
                rows.push({
                    id: userId,
                    userId,
                    displayName: userId,
                    source: 'instance-api'
                });
            }
            return;
        }
        if (typeof value !== 'object') {
            return;
        }
        if (
            !value.id &&
            !value.userId &&
            !value.user_id &&
            !value.displayName &&
            !value.display_name &&
            !value.username &&
            !value.name
        ) {
            for (const entry of Object.values(value)) {
                push(entry);
            }
            return;
        }

        const userId = normalizeString(value.id || value.userId || value.user_id);
        const displayName = normalizeString(
            value.displayName ||
                value.display_name ||
                value.username ||
                value.name ||
                userId
        );
        const key = userId || displayName.toLowerCase();
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        rows.push({
            ...value,
            id: userId || key,
            userId,
            displayName,
            source: 'instance-api'
        });
    };

    for (const source of sources) {
        push(source);
    }

    return rows;
}

export function PlayerListPage({ embedded = false } = {}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentUserLocation = useRuntimeStore((state) => {
        return (
            state.gameState.currentLocation ||
            state.auth.currentUserSnapshot?.location ||
            ''
        );
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
    const gameLogTailSyncedAt = useRuntimeStore(
        (state) => state.updateLoop.lastGameLogSyncAt
    );
    const runtimePlayerRows = useRuntimeStore(
        (state) => state.gameState.currentLocationPlayers
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
    const [clockNow, setClockNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = window.setInterval(() => {
            setClockNow(Date.now());
        }, 30000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

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

        if (currentUserLocation === 'traveling') {
            setLoadStatus('idle');
            setDetail('');
            setContext({
                createdAt: '',
                location: 'traveling',
                worldId: '',
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
            .then(async (result) => {
                if (!active) {
                    return;
                }

                const parsed = parseLocation(result.context?.location || '');
                let players = Array.isArray(result.players)
                    ? result.players
                    : [];
                if (!players.length && parsed.worldId && parsed.instanceId) {
                    const response = await instanceRepository
                        .getInstance({
                            worldId: parsed.worldId,
                            instanceId: parsed.instanceId,
                            endpoint: currentUserEndpoint,
                            force: true
                        })
                        .catch(() => null);
                    if (!active) {
                        return;
                    }
                    players = normalizeApiInstanceUsers(
                        response?.json?.users,
                        response?.json?.players,
                        response?.json?.playerList,
                        response?.json?.userList,
                        response?.json?.userIds,
                        response?.json?.usersById
                    );
                }

                setContext({
                    ...result.context,
                    playerCount: players.length || result.context.playerCount
                });
                setPlayerRows(players);
                setLoadStatus('ready');
                setDetail(
                    result.context.source === 'database'
                        ? 'Rebuilt the current instance roster from local join/leave history.'
                        : players.length
                          ? 'Loaded current instance users from the VRChat instance API while local game-log history catches up.'
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
        currentUserEndpoint,
        currentUserId,
        currentUserLocation,
        currentUserWorldId,
        gameLogTailSyncedAt,
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
            runtimePlayerRows,
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
        playerRows,
        runtimePlayerRows
    ]);

    const enrichedRows = useMemo(() => {
        return enrichPlayerListRows({
            clockNow,
            context,
            currentUserId,
            currentUserSnapshot,
            favoriteFriendIds,
            friendsById,
            moderationByUserId,
            playerSourceRows
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
                toast.info(
                    t(
                        'view.player_list.generated.no_user_id_was_found_for_this_player_row'
                    )
                );
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
            toast.info(
                t(
                    'view.player_list.generated.no_user_id_was_found_for_this_player_row'
                )
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.player_list.generated_toast.failed_to_look_up_this_player'
                      )
            );
        }
    }

    return (
        <PageScaffold
            embedded={embedded}
            className="overflow-x-hidden overflow-y-auto"
        >
            <PlayerListWorldHeader
                clockNow={clockNow}
                context={context}
                currentUserEndpoint={currentUserEndpoint}
                currentUserLocation={currentUserLocation}
                currentUserSnapshot={currentUserSnapshot}
                friendCount={headerFriendCount}
                isGameRunning={isGameRunning}
                onPreviewImage={openImagePreview}
                playerCount={headerPlayerCount}
                startedAt={currentLocationStartedAt}
                t={t}
            />

            <PlayerListTableSection
                detail={detail}
                filteredRows={filteredRows}
                gameLogDisabled={gameLogDisabled}
                isGameRunning={isGameRunning}
                isPlayerListSourceUnavailable={isPlayerListSourceUnavailable}
                loadStatus={loadStatus}
                onOpenPlayer={openPlayerRow}
                parsedLocation={parsedLocation}
                playerSourceRows={playerSourceRows}
            />
        </PageScaffold>
    );
}
