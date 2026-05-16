// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';

import {
    createInstanceUserRow as createLocationUserRow,
    isSameInstanceLocation as isSameLocationTag,
    mergeInstanceUser as mergeLocationUser,
    mergeInstanceUserRows as mergeLocationUserRows,
    pushInstanceUserSource as pushLocationUserSource,
    resolvePresenceLocation,
    userDisplayName
} from '@/components/instances/instanceRoster.js';
import {
    instanceRepository,
    playerListRepository,
    userProfileRepository
} from '@/repositories/index.js';
import {
    recordGameRuntimePresence,
    recordKnownUsers,
    recordLocationHintsFromInstances
} from '@/services/domainIngestionService.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/location.js';

import {
    buildCachedInstanceMap,
    locationCacheKey,
    resolveCurrentInviteLocation
} from './userDialogContentHelpers.js';
import {
    loadLocationOwner,
    resolveGroupFallback,
    resolveOwnerId,
    resolveOwnerSeed
} from './userDialogLocationOwner.js';
import { normalizeUserId } from './userProfileFields.js';

const locationUserProfileFetchConcurrency = 4;

export function createEmptyUserDialogLocationPanel(location = '') {
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

function sortLocationUsers(users) {
    return [...users].sort((left, right) =>
        userDisplayName(left).localeCompare(userDisplayName(right), undefined, {
            sensitivity: 'base'
        })
    );
}

function locationUserHasImage(user) {
    return Boolean(
        user?.profilePicOverrideThumbnail ||
        user?.profilePicOverride ||
        user?.thumbnailUrl ||
        user?.currentAvatarThumbnailImageUrl ||
        user?.currentAvatarImageUrl
    );
}

function locationUserId(user) {
    return normalizeUserId(
        user?.id ||
            user?.userId ||
            user?.user_id ||
            user?.targetUserId ||
            user?.target_user_id
    );
}

function mergeProfileIntoLocationUser(user, profile) {
    const row = createLocationUserRow(profile, {
        id: locationUserId(user),
        userId: locationUserId(user),
        displayName: user?.displayName,
        subtitle: user?.$subtitle || user?.subtitle || '',
        joinedAt: user?.joinedAt || user?.joined_at || user?.$location_at || ''
    });
    return mergeLocationUserRows(user, row);
}

async function enrichLocationUsersWithProfiles({
    endpoint,
    knownUsersById,
    shouldContinue = () => true,
    users
}) {
    const nextUsers = [...users];
    const fetchTargets = [];

    for (let index = 0; index < nextUsers.length; index += 1) {
        const user = nextUsers[index];
        const userId = locationUserId(user);
        if (!userId.startsWith('usr_') || locationUserHasImage(user)) {
            continue;
        }

        const knownUser = knownUsersById.get(userId);
        if (locationUserHasImage(knownUser)) {
            nextUsers[index] = mergeProfileIntoLocationUser(user, knownUser);
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
                try {
                    const profile = await userProfileRepository.getUserProfile({
                        userId: target.userId,
                        endpoint
                    });
                    if (!shouldContinue()) {
                        return;
                    }
                    nextUsers[target.index] = mergeProfileIntoLocationUser(
                        nextUsers[target.index],
                        profile
                    );
                } catch {
                    // Keep the lightweight row when the profile endpoint is unavailable.
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
    profile,
    reloadToken
}) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const currentGameLocation = normalizeUserId(gameState?.currentLocation);
    const currentSnapshotLocation = normalizeUserId(
        currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
    );
    const currentInviteLocation = resolveCurrentInviteLocation(
        gameState,
        currentUserSnapshot
    );
    const groupInstances =
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const groupInstancesRevision =
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.lastLoadedAt ||
              groupInstancesState.fetchedAt ||
              groupInstancesState.status
            : '';
    const [locationPanel, setLocationPanel] = useState(() =>
        createEmptyUserDialogLocationPanel()
    );
    const [currentInviteInstance, setCurrentInviteInstance] = useState(null);
    const [currentInviteInstanceStatus, setCurrentInviteInstanceStatus] =
        useState('idle');
    const [locationRefreshToken, setLocationRefreshToken] = useState(0);

    useEffect(() => {
        let active = true;

        const activeLocation = resolvePresenceLocation(profile);
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
        const snapshotLocation =
            currentLocationMatches && currentLocation
                ? currentLocation
                : activeLocation;
        const rowsById = new Map();
        const knownUsersById = new Map();

        function addKnownUser(user) {
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

        function userIsAtLocation(user) {
            if (!user) {
                return false;
            }
            return isSameLocationTag(
                resolvePresenceLocation(user, { requireInstance: true }),
                activeLocation
            );
        }

        addKnownUser(profile);
        addKnownUser(currentUserSnapshot);
        for (const friend of Object.values(friendsById)) {
            addKnownUser(friend);
        }

        mergeLocationUser(rowsById, profile);
        if (currentLocationMatches) {
            mergeLocationUser(rowsById, currentUserSnapshot);
        }

        for (const friend of Object.values(friendsById)) {
            if (!userIsAtLocation(friend)) {
                continue;
            }
            if (friend?.state !== 'online' && friend?.location === 'private') {
                continue;
            }
            mergeLocationUser(rowsById, friend);
        }

        const locationMetadata =
            profile?.$location && typeof profile.$location === 'object'
                ? profile.$location
                : {};
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
            endpoint: currentEndpoint,
            groupFallback: resolveGroupFallback(locationMetadata, ownerId)
        });
        const instancePromise = canFetchInstance
            ? instanceRepository
                  .getInstance({
                      worldId: parsedLocation.worldId,
                      instanceId: parsedLocation.instanceId,
                      endpoint: currentEndpoint
                  })
                  .then((response) => response.json)
                  .catch(() => null)
            : Promise.resolve(null);
        const playerSnapshotPromise = currentLocationMatches
            ? playerListRepository
                  .getCurrentInstanceSnapshot({
                      currentUserId: normalizedCurrentUserId,
                      currentLocation: snapshotLocation
                  })
                  .catch(() => null)
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
                    let ownerUser = ownerPayload?.ownerUser || null;
                    let ownerGroup = ownerPayload?.ownerGroup || null;
                    const instance =
                        instanceResult.status === 'fulfilled'
                            ? instanceResult.value
                            : null;
                    const playerSnapshot =
                        playerSnapshotResult.status === 'fulfilled'
                            ? playerSnapshotResult.value
                            : null;
                    const snapshotPlayers = Array.isArray(
                        playerSnapshot?.players
                    )
                        ? playerSnapshot.players
                        : [];
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
                                endpoint: currentEndpoint,
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

                    for (const player of playerSnapshot?.players || []) {
                        const playerId = normalizeUserId(
                            player.userId ||
                                player.user_id ||
                                player.id ||
                                player.targetUserId ||
                                player.target_user_id
                        );
                        const knownUser = playerId
                            ? knownUsersById.get(playerId)
                            : null;
                        mergeLocationUser(rowsById, knownUser || player, {
                            id: playerId,
                            userId: playerId,
                            displayName:
                                player.displayName || player.display_name,
                            joinedAt: player.joinedAt || player.joined_at
                        });
                    }

                    const users = sortLocationUsers(
                        Array.from(rowsById.values())
                    );
                    const friendCount = users.filter((user) => {
                        const userId = normalizeUserId(
                            user?.id || user?.userId
                        );
                        return Boolean(userId && friendsById[userId]);
                    }).length;
                    const instanceFriendCount =
                        Number(
                            instance?.friendCount ||
                                instance?.friendsCount ||
                                instance?.n_friends ||
                                friendCount
                        ) || friendCount;

                    setLocationPanel({
                        location: activeLocation,
                        instance,
                        ownerUser,
                        ownerGroup,
                        users,
                        friendCount: instanceFriendCount,
                        playerCount:
                            Number(
                                instance?.userCount ||
                                    instance?.occupants ||
                                    playerSnapshot?.context?.playerCount ||
                                    users.length
                            ) || users.length
                    });

                    enrichLocationUsersWithProfiles({
                        endpoint: currentEndpoint,
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

                const users = sortLocationUsers(Array.from(rowsById.values()));
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
        locationRefreshToken,
        normalizedCurrentUserId,
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
        instanceRepository
            .getInstance({
                worldId: parsedLocation.worldId,
                instanceId: parsedLocation.instanceId,
                endpoint: currentEndpoint
            })
            .then((response) => {
                if (!active) {
                    return;
                }
                const instance = response?.json || null;
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

    function refreshLocationPanel(requestLocation) {
        const activeLocation = resolvePresenceLocation(profile);
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

        function setCachedInstance(location, instance) {
            if (!location || !instance) {
                return;
            }

            const key = locationCacheKey(location);
            const existing =
                cache.get(location) || (key ? cache.get(key) : null);
            const merged =
                existing?.closedAt && !instance?.closedAt
                    ? { ...instance, closedAt: existing.closedAt }
                    : instance;

            cache.set(location, merged);
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
            currentUserId,
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
