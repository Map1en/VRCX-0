// @ts-nocheck
import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PageScaffold } from '@/components/layout/PageScaffold';
import { useCurrentInstancePresence } from '@/domain/presence/useCurrentInstancePresence.js';
import { recordUserProfile } from '@/domain/users/userFactAccess.js';
import { useKnownUserFacts } from '@/domain/users/useKnownUser.js';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { backend } from '@/platform/index.js';
import {
    instanceRepository,
    playerListRepository,
    userProfileRepository,
    vrchatAuthRepository,
    vrchatFriendRepository,
    vrchatModerationRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import {
    recordGameRuntimePresence,
    recordLocationHintsFromInstances
} from '@/services/domainIngestionService.js';
import { resolveUserByDisplayName } from '@/services/userIdentityService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { normalizeLanguageOptionsFromConfig } from '@/shared/utils/userLanguage.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { PlayerListTableSection } from './components/PlayerListTableSection';
import { PlayerListWorldHeader } from './components/PlayerListWorldHeader';
import { enrichPlayerListRows } from './playerListEnrichment.js';
import {
    buildFavoriteIdSet,
    buildPlayerDialogSeedData,
    buildPlayerSourceRows,
    isLiveLocation,
    mergePlayerRowsWithApiUsers,
    normalizeString,
    resolvePlayerRowUserId,
    shouldFetchInstanceUsers
} from './playerListRows.js';

function normalizeLogLocationSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return null;
    }

    const location = normalizeString(snapshot.location);
    if (!isLiveLocation(location)) {
        return null;
    }

    return {
        location,
        worldName: normalizeString(snapshot.worldName),
        createdAt:
            normalizeString(snapshot.createdAt) || new Date().toISOString(),
        fileName: normalizeString(snapshot.fileName)
    };
}

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

        const userId = normalizeString(
            value.id || value.userId || value.user_id
        );
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
            ref:
                value.ref && typeof value.ref === 'object'
                    ? value.ref
                    : value,
            source: 'instance-api'
        });
    };

    for (const source of sources) {
        push(source);
    }

    return rows;
}

function buildPlayerProfileIds(playerRows, currentUserId) {
    const currentUserKey = normalizeString(currentUserId);
    const ids = [];
    const seen = new Set();

    for (const row of Array.isArray(playerRows) ? playerRows : []) {
        const userId = resolvePlayerRowUserId(row);
        if (!userId || userId === currentUserKey || seen.has(userId)) {
            continue;
        }
        seen.add(userId);
        ids.push(userId);
    }

    return ids;
}

function mapProfileQueryResults(userIds, results) {
    const profilesByUserId = {};

    for (const [index, result] of results.entries()) {
        if (!result.data) {
            continue;
        }

        const profile = userProfileRepository.normalize(result.data);
        const userId = normalizeString(profile?.id || userIds[index]);
        if (userId) {
            profilesByUserId[userId] = profile;
        }
    }

    return profilesByUserId;
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
    const domainCurrentInstancePresence = useCurrentInstancePresence();
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
    const [logLocationSnapshot, setLogLocationSnapshot] = useState(null);
    const [moderationByUserId, setModerationByUserId] = useState({});
    const [languageOptions, setLanguageOptions] = useState([]);
    const [clockNow, setClockNow] = useState(() => Date.now());

    const playerListLocation =
        currentUserLocation || logLocationSnapshot?.location || '';
    const playerListWorldId =
        currentUserWorldId || parseLocation(playerListLocation).worldId || '';
    const playerListStartedAt =
        currentLocationStartedAt || logLocationSnapshot?.createdAt || '';

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

        if (currentUserLocation || !isGameRunning || gameLogDisabled) {
            setLogLocationSnapshot(null);
            return () => {
                active = false;
            };
        }

        if (logLocationSnapshot) {
            return () => {
                active = false;
            };
        }

        backend.logWatcher
            .GetCurrentLocation()
            .then((snapshot) => {
                if (!active) {
                    return;
                }

                const normalized = normalizeLogLocationSnapshot(snapshot);
                const normalizedKey = JSON.stringify(normalized || null);
                setLogLocationSnapshot((previous) =>
                    JSON.stringify(previous || null) === normalizedKey
                        ? previous
                        : normalized
                );
            })
            .catch(() => {
                if (!active) {
                    return;
                }

                setLogLocationSnapshot(null);
            });

        return () => {
            active = false;
        };
    }, [
        addGameLogEventCount,
        currentUserId,
        currentUserLocation,
        gameLogDisabled,
        isGameRunning,
        logLocationSnapshot
    ]);

    useEffect(() => {
        let active = true;

        if (gameLogDisabled) {
            setLoadStatus('idle');
            setDetail('Game log ingestion is disabled.');
            setContext({
                createdAt: '',
                location: playerListLocation || '',
                worldId: playerListWorldId || '',
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
                location: playerListLocation || '',
                worldId: playerListWorldId || '',
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

        if (!playerListLocation) {
            setLoadStatus('idle');
            setDetail('Waiting for the current runtime location.');
            setContext({
                createdAt: '',
                location: '',
                worldId: playerListWorldId || '',
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

        if (playerListLocation === 'traveling') {
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
                currentLocation: playerListLocation,
                currentLocationStartedAt: playerListStartedAt
            })
            .then(async (result) => {
                if (!active) {
                    return;
                }

                const parsed = parseLocation(result.context?.location || '');
                let players = Array.isArray(result.players)
                    ? result.players
                    : [];
                let instancePayload = null;
                if (
                    parsed.worldId &&
                    parsed.instanceId &&
                    shouldFetchInstanceUsers(players)
                ) {
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
                    instancePayload = response?.json || null;
                    const instanceUsers = normalizeApiInstanceUsers(
                        instancePayload?.users,
                        instancePayload?.players,
                        instancePayload?.playerList,
                        instancePayload?.userList,
                        instancePayload?.userIds,
                        instancePayload?.usersById
                    );
                    players = players.length
                        ? mergePlayerRowsWithApiUsers(players, instanceUsers)
                        : instanceUsers;
                }

                const nextContext = {
                    ...result.context,
                    playerCount: players.length || result.context.playerCount
                };
                if (
                    logLocationSnapshot?.location &&
                    logLocationSnapshot.location === nextContext.location
                ) {
                    nextContext.createdAt =
                        nextContext.createdAt || logLocationSnapshot.createdAt;
                    nextContext.worldName =
                        nextContext.worldName || logLocationSnapshot.worldName;
                }
                recordLocationHintsFromInstances({
                    endpoint: currentUserEndpoint,
                    instances: [
                        {
                            ...(instancePayload || {}),
                            location: nextContext.location || playerListLocation,
                            worldId: parsed.worldId || nextContext.worldId,
                            instanceId: parsed.instanceId,
                            worldName: nextContext.worldName,
                            users: players,
                            players
                        }
                    ]
                });
                recordGameRuntimePresence({
                    endpoint: currentUserEndpoint,
                    currentUserId,
                    currentUserSnapshot,
                    currentLocation: nextContext.location || playerListLocation,
                    currentLocationStartedAt:
                        nextContext.createdAt || playerListStartedAt,
                    currentLocationPlayers: players,
                    currentWorldName: nextContext.worldName
                });
                setContext(nextContext);
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
        currentUserSnapshot,
        gameLogTailSyncedAt,
        gameLogDisabled,
        isGameRunning,
        logLocationSnapshot?.createdAt,
        logLocationSnapshot?.location,
        logLocationSnapshot?.worldName,
        playerListLocation,
        playerListStartedAt,
        playerListWorldId
    ]);

    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const languageOptionsMap = useMemo(
        () => new Map(languageOptions.map((option) => [option.key, option])),
        [languageOptions]
    );

    useEffect(() => {
        let active = true;
        setLanguageOptions([]);

        vrchatAuthRepository
            .getConfig({ endpoint: currentUserEndpoint })
            .then((response) => {
                if (!active) {
                    return;
                }

                setLanguageOptions(
                    normalizeLanguageOptionsFromConfig(response.json)
                );
            })
            .catch(() => {
                if (active) {
                    setLanguageOptions([]);
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserEndpoint]);

    const playerSourceRows = useMemo(() => {
        const domainRuntimeRows = domainCurrentInstancePresence
            ? Object.values(domainCurrentInstancePresence.playersById || {})
            : [];
        return buildPlayerSourceRows({
            playerRows,
            runtimePlayerRows:
                runtimePlayerRows && runtimePlayerRows.length
                    ? runtimePlayerRows
                    : domainRuntimeRows,
            currentUserId,
            currentUserSnapshot,
            isGameRunning,
            context,
            currentUserLocation: playerListLocation,
            currentLocationStartedAt: playerListStartedAt
        });
    }, [
        context.createdAt,
        context.location,
        currentUserId,
        currentUserSnapshot,
        domainCurrentInstancePresence,
        isGameRunning,
        playerListLocation,
        playerListStartedAt,
        playerRows,
        runtimePlayerRows
    ]);

    const playerProfileIds = useMemo(
        () => buildPlayerProfileIds(playerSourceRows, currentUserId),
        [currentUserId, playerSourceRows]
    );
    const knownUsersById = useKnownUserFacts(playerProfileIds, {
        endpoint: currentUserEndpoint
    });
    const profilesByUserId = useQueries({
        queries: playerProfileIds.map((userId) => ({
            queryKey: queryKeys.user(userId, currentUserEndpoint),
            queryFn: async () => {
                const response = await vrchatFriendRepository.getUser({
                    userId,
                    endpoint: currentUserEndpoint
                });
                const profile = userProfileRepository.normalize(response.json);
                recordUserProfile(profile, {
                    endpoint: currentUserEndpoint,
                    source: 'profile'
                });
                return profile;
            },
            enabled: Boolean(userId),
            staleTime: 0,
            gcTime: entityQueryPolicies.user.gcTime,
            retry: entityQueryPolicies.user.retry,
            refetchOnWindowFocus: entityQueryPolicies.user.refetchOnWindowFocus
        })),
        combine: (results) => mapProfileQueryResults(playerProfileIds, results)
    });

    const enrichedRows = useMemo(() => {
        return enrichPlayerListRows({
            clockNow,
            context,
            currentUserId,
            currentUserSnapshot,
            favoriteFriendIds,
            friendsById,
            knownUsersById,
            languageOptionsMap,
            moderationByUserId,
            playerSourceRows,
            profilesByUserId
        });
    }, [
        clockNow,
        context.location,
        context.worldName,
        currentUserId,
        currentUserSnapshot,
        favoriteFriendIds,
        friendsById,
        knownUsersById,
        languageOptionsMap,
        moderationByUserId,
        playerSourceRows,
        profilesByUserId
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
        () => parseLocation(context.location || playerListLocation || ''),
        [context.location, playerListLocation]
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
        const seedData = buildPlayerDialogSeedData(row);

        if (userId) {
            openUserDialog({ userId, title: displayName, seedData });
            return;
        }

        if (!displayName || displayName.startsWith('ID:')) {
            return;
        }

        try {
            const resolved = await resolveUserByDisplayName(displayName, {
                endpoint: currentUserEndpoint
            });
            if (resolved?.userId) {
                openUserDialog({
                    userId: resolved.userId,
                    title: resolved.title || displayName,
                    seedData:
                        seedData || resolved.seedData
                            ? {
                                  ...(resolved.seedData || {}),
                                  ...(seedData || {}),
                                  id: resolved.userId,
                                  userId: resolved.userId
                              }
                            : null
                });
                return;
            }
            toast.info(
                t(
                    'view.player_list.empty.no_user_id_was_found_for_this_player_row'
                )
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.player_list.toast.failed_to_look_up_this_player'
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
                currentUserLocation={playerListLocation}
                currentUserSnapshot={currentUserSnapshot}
                friendCount={headerFriendCount}
                isGameRunning={isGameRunning}
                onPreviewImage={openImagePreview}
                playerCount={headerPlayerCount}
                startedAt={playerListStartedAt}
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
