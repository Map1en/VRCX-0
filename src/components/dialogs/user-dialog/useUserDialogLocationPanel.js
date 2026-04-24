import { useEffect, useMemo, useState } from 'react';

import {
    instanceRepository,
    playerListRepository
} from '@/repositories/index.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/location.js';

import {
    buildCachedInstanceMap,
    isSameLocationTag,
    locationCacheKey,
    mergeLocationUser,
    pushLocationUserSource,
    resolveCurrentInviteLocation,
    resolvePresenceLocation,
    userDisplayName
} from './userDialogContentHelpers.js';
import {
    loadLocationOwner,
    resolveGroupFallback,
    resolveOwnerId,
    resolveOwnerSeed
} from './userDialogLocationOwner.js';
import { normalizeUserId } from './userProfileFields.js';

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
    const currentGameDestination = normalizeUserId(
        gameState?.currentDestination
    );
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

        const currentLocation =
            currentGameLocation === 'traveling'
                ? currentGameDestination
                : currentGameLocation ||
                  currentGameDestination ||
                  currentSnapshotLocation;
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
                resolvePresenceLocation(user),
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
        currentGameDestination,
        currentGameLocation,
        currentSnapshotLocation,
        currentUserSnapshot,
        friendsById,
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
                setCurrentInviteInstance(response?.json || null);
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
