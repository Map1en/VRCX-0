import { useEffect, useMemo, useState } from 'react';

import { firstNonNegativeLocationNumber } from '@/components/location/locationModel';
import {
    resolveObservedPlayerUserId,
    resolveObservedPlayerUserIds,
    resolveSameInstanceFriendLocation
} from '@/domain/friends/sameInstanceFriends';
import type { CurrentInstanceRosterPlayer } from '@/domain/instances/currentInstanceRoster';
import {
    createInstanceUserRow as createLocationUserRow,
    isSameInstanceLocation as isSameLocationTag,
    mergeInstanceUser as mergeLocationUser,
    mergeInstanceUserRows as mergeLocationUserRows,
    pushInstanceUserSource as pushLocationUserSource,
    resolvePresenceLocation,
    userDisplayName,
    type InstanceRosterRow
} from '@/domain/instances/instanceRoster';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { loadCurrentInstanceRoster } from '@/services/currentInstanceRosterService';
import {
    recordGameRuntimePresence,
    recordKnownUsers,
    recordLocationHintsFromInstances
} from '@/services/domainIngestionService';
import { hasUserIdPrefix } from '@/shared/constants/vrchatIds';
import { checkCanInvite } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';

import {
    buildCachedInstanceMap,
    locationCacheKey,
    resolveCurrentInviteLocation
} from './userDialogContentHelpers';
import {
    loadLocationOwner,
    resolveGroupFallback,
    resolveOwnerId,
    resolveOwnerSeed
} from './userDialogLocationOwner';
import {
    filterVisibleUserDialogLocationUsers,
    shouldIncludeUserDialogLocationFriend
} from './userDialogLocationUsers';
import { normalizeUserId } from './userProfileFields';

const locationUserProfileFetchConcurrency = 4;

type UserDialogLocationPanelData = {
    location: unknown;
    instance: Record<string, unknown> | null;
    ownerUser: Record<string, unknown> | null;
    ownerGroup: Record<string, unknown> | null;
    users: InstanceRosterRow[];
    friendCount: number;
    playerCount: number;
};

type UserDialogLocationGameState = {
    currentDestination: string;
    currentLocation: string;
    currentLocationPlayerIds: string[];
    currentLocationPlayers: CurrentInstanceRosterPlayer[];
    currentLocationStartedAt: string | null;
    currentWorldId: string;
    currentWorldName: string;
    isGameRunning: boolean | null;
};

function recordValues(value: unknown): Record<string, unknown>[] {
    return value && typeof value === 'object'
        ? Object.values(value).map((entry) =>
              entry && typeof entry === 'object'
                  ? Object.fromEntries(Object.entries(entry))
                  : {}
          )
        : [];
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

export function createEmptyUserDialogLocationPanel(
    location: unknown = ''
): UserDialogLocationPanelData {
    return {
        location,
        instance: null,
        ownerUser: null,
        ownerGroup: null,
        users: [],
        friendCount: 0,
        playerCount: 0
    };
}

function sortLocationUsers(users: InstanceRosterRow[]) {
    return [...users].sort((left, right) =>
        userDisplayName(left).localeCompare(userDisplayName(right), undefined, {
            sensitivity: 'base'
        })
    );
}

function locationUserHasImage(userValue: unknown) {
    const user = record(userValue);
    return Boolean(
        user?.profilePicOverrideThumbnail ||
        user?.profilePicOverride ||
        user?.thumbnailUrl ||
        user?.currentAvatarThumbnailImageUrl ||
        user?.currentAvatarImageUrl
    );
}

function locationUserId(userValue: unknown) {
    const user = record(userValue);
    return normalizeUserId(
        user?.id ||
            user?.userId ||
            user?.user_id ||
            user?.targetUserId ||
            user?.target_user_id
    );
}

function mergeProfileIntoLocationUser(
    user: InstanceRosterRow,
    profile: unknown
) {
    const row = createLocationUserRow(record(profile), {
        id: locationUserId(user),
        userId: locationUserId(user),
        displayName: user?.displayName,
        subtitle: user?.$subtitle || user?.subtitle || '',
        joinedAt: user?.joinedAt || user?.joined_at || user?.$location_at || ''
    });
    return mergeLocationUserRows(user, row) ?? user;
}

async function enrichLocationUsersWithProfiles({
    knownUsersById,
    shouldContinue = () => true,
    users
}: {
    knownUsersById: Map<string, unknown>;
    shouldContinue?: () => boolean;
    users: InstanceRosterRow[];
}) {
    const nextUsers = [...users];
    const fetchTargets: Array<{ index: number; userId: string }> = [];

    for (let index = 0; index < nextUsers.length; index += 1) {
        const user = nextUsers[index];
        const userId = locationUserId(user);
        if (!hasUserIdPrefix(userId) || locationUserHasImage(user)) {
            continue;
        }

        const knownUser = knownUsersById.get(userId);
        if (locationUserHasImage(knownUser)) {
            nextUsers[index] = mergeProfileIntoLocationUser(
                user,
                record(knownUser)
            );
            continue;
        }

        fetchTargets.push({ index, userId });
    }

    if (!fetchTargets.length) {
        return nextUsers;
    }

    const queue = [...fetchTargets];
    const workers = Array.from(
        {
            length: Math.min(locationUserProfileFetchConcurrency, queue.length)
        },
        async () => {
            while (queue.length && shouldContinue()) {
                const target = queue.shift();
                if (!target) {
                    break;
                }
                try {
                    const profile = await userProfileRepository.getUserProfile({
                        userId: target.userId
                    });
                    if (!shouldContinue()) {
                        return;
                    }
                    const currentUser = nextUsers[target.index];
                    if (currentUser) {
                        nextUsers[target.index] = mergeProfileIntoLocationUser(
                            currentUser,
                            profile
                        );
                    }
                } catch {
                    // no-op
                }
            }
        }
    );

    await Promise.all(workers);
    return nextUsers;
}

export function useUserDialogLocationPanel({
    currentEndpoint,
    currentUserId,
    currentUserSnapshot,
    gameState,
    groupInstancesState,
    friendsById,
    presenceLocation,
    profile,
    reloadToken
}: {
    currentEndpoint: string;
    currentUserId: unknown;
    currentUserSnapshot: Record<string, unknown> | null;
    gameState: UserDialogLocationGameState | null;
    groupInstancesState: Record<string, unknown>;
    friendsById: Record<string, Record<string, unknown>>;
    presenceLocation: string;
    profile: Record<string, unknown> | null;
    reloadToken: number;
}) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const currentGameLocation = normalizeUserId(gameState?.currentLocation);
    const currentSnapshotLocation = normalizeUserId(
        currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
    );
    const currentInviteLocation = normalizeUserId(
        resolveCurrentInviteLocation(gameState, currentUserSnapshot)
    );
    const groupInstancesScopeMatches =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint;
    const groupInstances = groupInstancesScopeMatches
        ? groupInstancesState.instances
        : [];
    const groupInstancesRevision = groupInstancesScopeMatches
        ? groupInstancesState.lastLoadedAt ||
          groupInstancesState.fetchedAt ||
          groupInstancesState.status
        : '';
    const [locationPanel, setLocationPanel] = useState(() =>
        createEmptyUserDialogLocationPanel()
    );
    const [currentInviteInstance, setCurrentInviteInstance] = useState<Record<
        string,
        unknown
    > | null>(null);
    const [currentInviteInstanceStatus, setCurrentInviteInstanceStatus] =
        useState('idle');
    const [locationRefreshToken, setLocationRefreshToken] = useState(0);

    useEffect(() => {
        let active = true;

        const activeLocation =
            presenceLocation || resolvePresenceLocation(profile);
        const parsedLocation = parseLocation(activeLocation);
        if (
            !profile?.id ||
            !activeLocation ||
            parsedLocation.isOffline ||
            parsedLocation.isPrivate ||
            parsedLocation.isTraveling
        ) {
            setLocationPanel(createEmptyUserDialogLocationPanel());
            return () => {
                active = false;
            };
        }

        const currentLocation = currentGameLocation || currentSnapshotLocation;
        const currentLocationMatches = isSameLocationTag(
            currentLocation,
            activeLocation
        );
        const currentLocationPlayerIds = new Set(
            resolveObservedPlayerUserIds(
                gameState?.currentLocationPlayerIds,
                gameState?.currentLocationPlayers,
                friendsById
            )
        );
        const currentFriendLocationSnapshot = {
            location: currentLocation,
            friendList: currentLocationPlayerIds
        };
        const snapshotLocation =
            currentLocationMatches && currentLocation
                ? currentLocation
                : activeLocation;
        const rowsById = new Map<string, InstanceRosterRow>();
        const knownUsersById = new Map<string, unknown>();
        const visibleFriendIds = new Set<string>();

        function addKnownUser(userValue: unknown) {
            const user = record(userValue);
            const userId = normalizeUserId(
                user?.id ||
                    user?.userId ||
                    user?.user_id ||
                    user?.targetUserId ||
                    user?.target_user_id
            );
            if (userId && !knownUsersById.has(userId)) {
                knownUsersById.set(userId, user);
            }
        }

        function userIsAtLocation(user: unknown) {
            if (!user) {
                return false;
            }
            return isSameLocationTag(
                resolveSameInstanceFriendLocation(
                    user,
                    currentFriendLocationSnapshot
                ),
                activeLocation
            );
        }

        addKnownUser(profile);
        addKnownUser(currentUserSnapshot);
        for (const friend of recordValues(friendsById)) {
            addKnownUser(friend);
        }

        mergeLocationUser(rowsById, profile);
        if (currentLocationMatches) {
            mergeLocationUser(
                rowsById,
                currentUserSnapshot,
                {},
                {
                    incomingPresenceWins: gameState?.isGameRunning !== true
                }
            );
        }

        for (const friend of recordValues(friendsById)) {
            if (!userIsAtLocation(friend)) {
                continue;
            }
            if (
                !shouldIncludeUserDialogLocationFriend({
                    currentLocationMatches,
                    currentLocationPlayerIds,
                    friend
                })
            ) {
                continue;
            }
            const friendId = locationUserId(friend);
            if (friendId) {
                visibleFriendIds.add(friendId);
            }
            mergeLocationUser(rowsById, friend);
        }

        const locationMetadata = record(profile?.$location);
        pushLocationUserSource(
            [
                locationMetadata.users,
                locationMetadata.players,
                locationMetadata.friends
            ],
            (user) => mergeLocationUser(rowsById, user)
        );

        const canFetchInstance = Boolean(
            parsedLocation.worldId && parsedLocation.instanceId
        );
        const ownerId = resolveOwnerId(
            locationMetadata,
            parsedLocation.userId,
            parsedLocation.groupId
        );
        const ownerSeed = resolveOwnerSeed(
            locationMetadata,
            ownerId,
            knownUsersById
        );
        const ownerPromise = loadLocationOwner({
            ownerId,
            ownerSeed,
            groupFallback: resolveGroupFallback(locationMetadata, ownerId)
        });
        const instancePromise = canFetchInstance
            ? vrchatInstanceRepository
                  .getInstance({
                      worldId: parsedLocation.worldId,
                      instanceId: parsedLocation.instanceId,
                      endpoint: currentEndpoint
                  })
                  .then((response) => record(response.json))
                  .catch((): null => null)
            : Promise.resolve(null);
        const playerSnapshotPromise = currentLocationMatches
            ? loadCurrentInstanceRoster({
                  currentUserId: normalizedCurrentUserId,
                  currentLocation: snapshotLocation,
                  runtime: {
                      currentLocation: currentGameLocation,
                      currentLocationStartedAt:
                          gameState?.currentLocationStartedAt || null,
                      currentWorldId: gameState?.currentWorldId || '',
                      currentWorldName: gameState?.currentWorldName || '',
                      players: gameState?.currentLocationPlayers || []
                  }
              }).catch((): null => null)
            : Promise.resolve(null);

        Promise.allSettled([
            ownerPromise,
            instancePromise,
            playerSnapshotPromise
        ])
            .then(
                async ([ownerResult, instanceResult, playerSnapshotResult]) => {
                    if (!active) {
                        return;
                    }

                    const ownerPayload =
                        ownerResult.status === 'fulfilled'
                            ? ownerResult.value
                            : null;
                    let ownerUser: Record<string, unknown> | null =
                        ownerPayload?.ownerUser || null;
                    let ownerGroup: Record<string, unknown> | null =
                        ownerPayload?.ownerGroup || null;
                    const instance =
                        instanceResult.status === 'fulfilled'
                            ? instanceResult.value
                            : null;
                    const playerSnapshot =
                        playerSnapshotResult.status === 'fulfilled'
                            ? playerSnapshotResult.value
                            : null;
                    const snapshotPlayers = (playerSnapshot?.players || []).map(
                        (player) => {
                            const userId = resolveObservedPlayerUserId(
                                player,
                                friendsById
                            );
                            return {
                                id: userId,
                                userId,
                                displayName: player.displayName,
                                joinedAt: player.joinedAt
                            };
                        }
                    );
                    const instanceOwnerId = resolveOwnerId(
                        instance,
                        parsedLocation.userId,
                        parsedLocation.groupId
                    );

                    if (!ownerUser && !ownerGroup && instanceOwnerId) {
                        const fallback = resolveGroupFallback(
                            instance,
                            instanceOwnerId
                        );
                        const ownerPayloadFromInstance =
                            await loadLocationOwner({
                                ownerId: instanceOwnerId,
                                ownerSeed: resolveOwnerSeed(
                                    instance,
                                    instanceOwnerId,
                                    knownUsersById
                                ),
                                groupFallback: fallback
                            });

                        if (!active) {
                            return;
                        }

                        ownerUser = ownerPayloadFromInstance.ownerUser;
                        ownerGroup = ownerPayloadFromInstance.ownerGroup;
                    }

                    recordLocationHintsFromInstances({
                        endpoint: currentEndpoint,
                        instances: [
                            {
                                ...locationMetadata,
                                ...(instance || {}),
                                location: activeLocation,
                                worldId: parsedLocation.worldId,
                                instanceId: parsedLocation.instanceId,
                                users:
                                    instance?.users ||
                                    locationMetadata.users ||
                                    locationMetadata.friends,
                                players:
                                    instance?.players ||
                                    (snapshotPlayers.length
                                        ? snapshotPlayers
                                        : null) ||
                                    locationMetadata.players,
                                usersById: instance?.usersById,
                                userIds: instance?.userIds
                            }
                        ]
                    });
                    recordKnownUsers(snapshotPlayers, {
                        endpoint: currentEndpoint,
                        source: 'playerSnapshot'
                    });
                    if (currentLocationMatches) {
                        recordGameRuntimePresence({
                            endpoint: currentEndpoint,
                            currentUserId: normalizedCurrentUserId,
                            currentUserSnapshot,
                            currentLocation: snapshotLocation,
                            currentLocationStartedAt:
                                gameState?.currentLocationStartedAt ||
                                playerSnapshot?.context?.createdAt ||
                                '',
                            currentLocationPlayers: snapshotPlayers,
                            currentWorldName:
                                playerSnapshot?.context?.worldName ||
                                instance?.worldName ||
                                locationMetadata.worldName ||
                                ''
                        });
                    }

                    pushLocationUserSource(
                        [
                            instance?.users,
                            instance?.players,
                            instance?.playerList,
                            instance?.userList,
                            instance?.userIds,
                            instance?.usersById
                        ],
                        (user) => mergeLocationUser(rowsById, user)
                    );

                    for (const player of snapshotPlayers) {
                        const playerId = normalizeUserId(
                            player.userId || player.id
                        );
                        const knownUser = playerId
                            ? knownUsersById.get(playerId)
                            : null;
                        mergeLocationUser(
                            rowsById,
                            knownUser ? record(knownUser) : player,
                            {
                                id: playerId,
                                userId: playerId,
                                displayName: player.displayName,
                                joinedAt: player.joinedAt
                            }
                        );
                    }

                    const allUsers = sortLocationUsers(
                        Array.from(rowsById.values())
                    );
                    const users = filterVisibleUserDialogLocationUsers({
                        currentUserId: normalizedCurrentUserId,
                        friendsById,
                        location: activeLocation,
                        memberUserIds: visibleFriendIds,
                        users: allUsers
                    });
                    const friendCount = users.filter((user) => {
                        const userId = normalizeUserId(
                            user?.id || user?.userId
                        );
                        return Boolean(userId && friendsById[userId]);
                    }).length;

                    setLocationPanel({
                        location: activeLocation,
                        instance,
                        ownerUser,
                        ownerGroup,
                        users,
                        friendCount,
                        playerCount:
                            firstNonNegativeLocationNumber(
                                instance?.userCount,
                                instance?.occupants,
                                instance?.n_users,
                                playerSnapshot?.context?.playerCount
                            ) || allUsers.length
                    });

                    enrichLocationUsersWithProfiles({
                        knownUsersById,
                        shouldContinue: () => active,
                        users
                    }).then((enrichedUsers) => {
                        if (!active) {
                            return;
                        }
                        setLocationPanel((current) => {
                            if (
                                !isSameLocationTag(
                                    current.location,
                                    activeLocation
                                )
                            ) {
                                return current;
                            }
                            return {
                                ...current,
                                users: enrichedUsers
                            };
                        });
                    });
                }
            )
            .catch(() => {
                if (!active) {
                    return;
                }

                const allUsers = sortLocationUsers(
                    Array.from(rowsById.values())
                );
                const users = filterVisibleUserDialogLocationUsers({
                    currentUserId: normalizedCurrentUserId,
                    friendsById,
                    location: activeLocation,
                    memberUserIds: visibleFriendIds,
                    users: allUsers
                });
                setLocationPanel({
                    ...createEmptyUserDialogLocationPanel(activeLocation),
                    users,
                    friendCount: users.filter((user) => {
                        const userId = normalizeUserId(
                            user?.id || user?.userId
                        );
                        return Boolean(userId && friendsById[userId]);
                    }).length
                });
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        currentGameLocation,
        currentSnapshotLocation,
        currentUserSnapshot,
        friendsById,
        gameState?.currentLocationStartedAt,
        gameState?.currentLocationPlayerIds,
        gameState?.currentLocationPlayers,
        gameState?.currentWorldId,
        gameState?.currentWorldName,
        locationRefreshToken,
        normalizedCurrentUserId,
        presenceLocation,
        profile,
        reloadToken
    ]);

    useEffect(() => {
        let active = true;
        const parsedLocation = parseLocation(currentInviteLocation);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            setCurrentInviteInstance(null);
            setCurrentInviteInstanceStatus('idle');
            return () => {
                active = false;
            };
        }

        setCurrentInviteInstance(null);
        setCurrentInviteInstanceStatus('running');
        vrchatInstanceRepository
            .getInstance({
                worldId: parsedLocation.worldId,
                instanceId: parsedLocation.instanceId,
                endpoint: currentEndpoint
            })
            .then((response) => {
                if (!active) {
                    return;
                }
                const instance = response?.json ? record(response.json) : null;
                recordLocationHintsFromInstances({
                    endpoint: currentEndpoint,
                    instances: instance
                        ? [{ ...instance, location: currentInviteLocation }]
                        : []
                });
                setCurrentInviteInstance(instance);
                setCurrentInviteInstanceStatus('ready');
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setCurrentInviteInstance(null);
                setCurrentInviteInstanceStatus('error');
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentInviteLocation, reloadToken]);

    function refreshLocationPanel(requestLocation: unknown): null {
        const activeLocation =
            presenceLocation || resolvePresenceLocation(profile);
        if (
            requestLocation &&
            activeLocation &&
            !isSameLocationTag(requestLocation, activeLocation)
        ) {
            return null;
        }

        setLocationRefreshToken((value) => value + 1);
        return null;
    }

    const inviteInstanceCache = useMemo(() => {
        const cache = buildCachedInstanceMap(groupInstances);

        function setCachedInstance(location: unknown, instanceValue: unknown) {
            if (!location || !instanceValue) {
                return;
            }
            const instance = record(instanceValue);

            const normalizedLocation = normalizeUserId(location);
            const key = locationCacheKey(normalizedLocation);
            const existing =
                cache.get(normalizedLocation) || (key ? cache.get(key) : null);
            const merged =
                existing?.closedAt && !instance?.closedAt
                    ? { ...instance, closedAt: existing.closedAt }
                    : instance;

            cache.set(normalizedLocation, merged);
            if (key) {
                cache.set(key, merged);
            }
        }

        if (locationPanel.location && locationPanel.instance) {
            setCachedInstance(locationPanel.location, locationPanel.instance);
        }
        if (
            currentInviteLocation &&
            isSameLocationTag(locationPanel.location, currentInviteLocation) &&
            locationPanel.instance
        ) {
            setCachedInstance(currentInviteLocation, locationPanel.instance);
        }
        if (currentInviteLocation && currentInviteInstance) {
            setCachedInstance(currentInviteLocation, currentInviteInstance);
        }

        const currentInviteKey = locationCacheKey(currentInviteLocation);
        const cachedCurrentInviteInstance = currentInviteKey
            ? cache.get(currentInviteKey)
            : null;
        if (currentInviteLocation && cachedCurrentInviteInstance) {
            setCachedInstance(
                currentInviteLocation,
                cachedCurrentInviteInstance
            );
        }

        return cache;
    }, [
        currentInviteLocation,
        currentInviteInstance,
        groupInstances,
        groupInstancesRevision,
        locationPanel.instance,
        locationPanel.location
    ]);

    const canInviteFromCurrentLocation =
        currentInviteInstanceStatus !== 'running' &&
        checkCanInvite(currentInviteLocation, {
            currentUserId: normalizedCurrentUserId,
            lastLocationStr: '',
            cachedInstances: inviteInstanceCache
        });

    return {
        locationPanel,
        currentInviteLocation,
        canInviteFromCurrentLocation,
        refreshLocationPanel
    };
}
