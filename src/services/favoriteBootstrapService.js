import {
    localFavoritesRepository,
    vrchatFavoriteRepository
} from '@/repositories/index.js';
import {
    createDefaultFavoriteCachedRef,
    createDefaultFavoriteGroupRef
} from '@/shared/utils/entityTransforms.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { syncStartupServicesTask } from './startupServicesStatus.js';

const activeHydrations = new WeakMap();

function normalizeUserId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function getDisplayName(user) {
    return user?.displayName || user?.username || user?.id || '';
}

function uniqueValues(values) {
    return Array.from(new Set(Array.isArray(values) ? values : []));
}

function createDefaultFavoriteLimits() {
    return {
        maxFavoriteGroups: {
            avatar: 6,
            friend: 3,
            vrcPlusWorld: 4,
            world: 4
        },
        maxFavoritesPerGroup: {
            avatar: 50,
            friend: 150,
            vrcPlusWorld: 100,
            world: 100
        }
    };
}

function mergeFavoriteLimits(limits) {
    return {
        maxFavoriteGroups: {
            ...createDefaultFavoriteLimits().maxFavoriteGroups,
            ...(limits?.maxFavoriteGroups && typeof limits.maxFavoriteGroups === 'object'
                ? limits.maxFavoriteGroups
                : {})
        },
        maxFavoritesPerGroup: {
            ...createDefaultFavoriteLimits().maxFavoritesPerGroup,
            ...(limits?.maxFavoritesPerGroup && typeof limits.maxFavoritesPerGroup === 'object'
                ? limits.maxFavoritesPerGroup
                : {})
        }
    };
}

function buildFavoriteGroupsFromLimits(favoriteLimits) {
    const friendGroups = [];
    const worldGroups = [];
    const avatarGroups = [];

    for (let index = 0; index < favoriteLimits.maxFavoriteGroups.friend; index += 1) {
        friendGroups.push({
            assign: false,
            key: `friend:group_${index}`,
            type: 'friend',
            name: `group_${index}`,
            displayName: `Group ${index + 1}`,
            capacity: favoriteLimits.maxFavoritesPerGroup.friend,
            count: 0,
            visibility: 'private'
        });
    }

    for (let index = 0; index < favoriteLimits.maxFavoriteGroups.world; index += 1) {
        worldGroups.push({
            assign: false,
            key: `world:worlds${index + 1}`,
            type: 'world',
            name: `worlds${index + 1}`,
            displayName: `Group ${index + 1}`,
            capacity: favoriteLimits.maxFavoritesPerGroup.world,
            count: 0,
            visibility: 'private'
        });
    }

    for (let index = 0; index < favoriteLimits.maxFavoriteGroups.vrcPlusWorld; index += 1) {
        worldGroups.push({
            assign: false,
            key: `vrcPlusWorld:vrcPlusWorlds${index + 1}`,
            type: 'vrcPlusWorld',
            name: `vrcPlusWorlds${index + 1}`,
            displayName: `VRC+ Group ${index + 1}`,
            capacity: favoriteLimits.maxFavoritesPerGroup.vrcPlusWorld,
            count: 0,
            visibility: 'private'
        });
    }

    for (let index = 0; index < favoriteLimits.maxFavoriteGroups.avatar; index += 1) {
        avatarGroups.push({
            assign: false,
            key: `avatar:avatars${index + 1}`,
            type: 'avatar',
            name: `avatars${index + 1}`,
            displayName: `Group ${index + 1}`,
            capacity: favoriteLimits.maxFavoritesPerGroup.avatar,
            count: 0,
            visibility: 'private'
        });
    }

    return {
        friendGroups,
        worldGroups,
        avatarGroups
    };
}

function assignFavoriteGroupMetadata(groupsByType, cachedFavoriteGroupsById) {
    const typeLookup = {
        friend: groupsByType.friendGroups,
        world: groupsByType.worldGroups,
        vrcPlusWorld: groupsByType.worldGroups,
        avatar: groupsByType.avatarGroups
    };
    const assignments = new Set();
    const refs = Object.values(cachedFavoriteGroupsById);

    for (const ref of refs) {
        const groups = typeLookup[ref.type];
        if (!groups) {
            continue;
        }

        for (const group of groups) {
            if (!group.assign && group.name === ref.name) {
                group.assign = true;
                if (ref.displayName) {
                    group.displayName = ref.displayName;
                }
                group.visibility = ref.visibility || group.visibility;
                assignments.add(ref.id);
                break;
            }
        }
    }

    for (const ref of refs) {
        if (assignments.has(ref.id)) {
            continue;
        }

        const groups = typeLookup[ref.type];
        if (!groups) {
            continue;
        }

        for (const group of groups) {
            if (!group.assign) {
                group.assign = true;
                group.key = `${group.type}:${ref.name}`;
                group.name = ref.name;
                group.displayName = ref.displayName || group.displayName;
                group.visibility = ref.visibility || group.visibility;
                assignments.add(ref.id);
                break;
            }
        }
    }
}

function buildFavoriteGroupIndex({ friendGroups, worldGroups, avatarGroups }) {
    const groupsByKey = {};
    for (const group of friendGroups) {
        groupsByKey[group.key] = group;
    }
    for (const group of worldGroups) {
        groupsByKey[group.key] = group;
    }
    for (const group of avatarGroups) {
        groupsByKey[group.key] = group;
    }
    return groupsByKey;
}

function countFavoriteGroups(groupsByKey, remoteFavoritesById) {
    for (const group of Object.values(groupsByKey)) {
        group.count = 0;
    }

    for (const favorite of Object.values(remoteFavoritesById)) {
        const group = groupsByKey[favorite.$groupKey];
        if (group) {
            group.count += 1;
        }
    }
}

function buildRemoteFavoriteSnapshot(remoteFavorites, friendRosterById) {
    const remoteFavoritesById = {};
    const remoteFavoritesByObjectId = {};
    const favoritesSortOrder = [];
    const favoriteFriendIds = [];
    const favoriteWorldIds = [];
    const favoriteAvatarIds = [];
    const groupedFavoriteFriendIdsByGroupKey = {};

    for (const json of remoteFavorites) {
        const favorite = createDefaultFavoriteCachedRef(json);
        if (!favorite.id || !favorite.favoriteId) {
            continue;
        }

        remoteFavoritesById[favorite.id] = favorite;
        remoteFavoritesByObjectId[favorite.favoriteId] = favorite;
        favoritesSortOrder.push(favorite.favoriteId);

        if (favorite.type === 'friend') {
            favoriteFriendIds.push(favorite.favoriteId);
            if (!groupedFavoriteFriendIdsByGroupKey[favorite.$groupKey]) {
                groupedFavoriteFriendIdsByGroupKey[favorite.$groupKey] = [];
            }
            groupedFavoriteFriendIdsByGroupKey[favorite.$groupKey].push(
                friendRosterById[favorite.favoriteId]?.id || favorite.favoriteId
            );
        } else if (favorite.type === 'avatar') {
            favoriteAvatarIds.push(favorite.favoriteId);
        } else if (favorite.type === 'world' || favorite.type === 'vrcPlusWorld') {
            favoriteWorldIds.push(favorite.favoriteId);
        }
    }

    return {
        remoteFavoritesById,
        remoteFavoritesByObjectId,
        favoritesSortOrder,
        favoriteFriendIds,
        favoriteWorldIds,
        favoriteAvatarIds,
        groupedFavoriteFriendIdsByGroupKey
    };
}

function buildLocalGroupedIds(rows, idField, explicitGroups = [], fallbackGroup = 'Favorites') {
    const groups = Object.create(null);
    const list = [];

    for (const groupName of explicitGroups) {
        const normalizedGroupName = normalizeUserId(groupName);
        if (normalizedGroupName && !groups[normalizedGroupName]) {
            groups[normalizedGroupName] = [];
        }
    }

    for (const row of rows) {
        const groupName =
            typeof row?.groupName === 'string' && row.groupName.trim()
                ? row.groupName.trim()
                : fallbackGroup;
        const objectId =
            typeof row?.[idField] === 'string'
                ? row[idField].trim()
                : String(row?.[idField] ?? '').trim();
        if (!objectId) {
            continue;
        }

        if (!groups[groupName]) {
            groups[groupName] = [];
        }
        groups[groupName].unshift(objectId);
        list.push(objectId);
    }

    if (Object.keys(groups).length === 0) {
        groups[fallbackGroup] = [];
    }

    return {
        groups,
        groupsList: Object.keys(groups).sort(),
        list: uniqueValues(list)
    };
}

function buildDetailsById(rows) {
    const detailsById = {};
    for (const row of rows) {
        const objectId =
            typeof row?.id === 'string' ? row.id.trim() : String(row?.id ?? '').trim();
        if (!objectId) {
            continue;
        }
        detailsById[objectId] = row;
    }
    return detailsById;
}

function ensureLocalDetailFallbacks(detailsById, objectIds) {
    for (const objectId of objectIds) {
        if (!objectId) {
            continue;
        }
        if (!detailsById[objectId]) {
            detailsById[objectId] = { id: objectId };
        }
    }
    return detailsById;
}

function buildPendingDetail(displayName, snapshot) {
    return [
        `Favorites baseline loaded for ${displayName} (${Object.keys(snapshot.remoteFavoritesById).length} remote records).`,
        `${snapshot.localWorldFavoritesList.length} local world favorites, ${snapshot.localAvatarFavoritesList.length} local avatar favorites, ${snapshot.localFriendFavoritesList.length} local friend favorites.`
    ].join(' ');
}

function isCurrentFavoriteBootstrapTarget(userId, currentUserSnapshot) {
    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();

    return (
        runtimeState.auth.currentUserId === userId &&
        runtimeState.auth.currentUserSnapshot === currentUserSnapshot &&
        sessionState.isLoggedIn &&
        sessionState.sessionPhase === 'ready'
    );
}

async function runFavoriteBootstrap({ userId, endpoint = '', currentUserSnapshot }) {
    const normalizedUserId = normalizeUserId(userId || currentUserSnapshot?.id);
    if (!normalizedUserId) {
        throw new Error('Favorites hydration requires an authenticated user id.');
    }

    const displayName = getDisplayName(currentUserSnapshot) || normalizedUserId;
    const friendRosterById = useFriendRosterStore.getState().friendsById;

    useFavoriteStore.getState().setFavoritesLoading(
        normalizedUserId,
        `Loading favorites baseline for ${displayName}.`
    );
    useSessionStore.getState().setFavoritesLoaded(false);
    useRuntimeStore.getState().setStartupTask(
        'services',
        'running',
        `Loading favorites baseline for ${displayName}.`
    );

    const [
        favoriteLimitsResponse,
        remoteFavorites,
        remoteFavoriteGroups,
        localWorldFavoriteRows,
        localAvatarFavoriteRows,
        localFriendFavoriteRows,
        localWorldCacheRows,
        localAvatarCacheRows,
        explicitLocalWorldFavoriteGroups,
        explicitLocalAvatarFavoriteGroups,
        explicitLocalFriendFavoriteGroups
    ] = await Promise.all([
        vrchatFavoriteRepository.getFavoriteLimits({ endpoint }),
        vrchatFavoriteRepository.getAllFavorites({ endpoint }),
        vrchatFavoriteRepository.getAllFavoriteGroups({ endpoint }),
        localFavoritesRepository.getWorldFavorites(),
        localFavoritesRepository.getAvatarFavorites(),
        localFavoritesRepository.getFriendFavorites(),
        localFavoritesRepository.getWorldCache(),
        localFavoritesRepository.getAvatarCache(),
        localFavoritesRepository.getExplicitLocalFavoriteGroups('world'),
        localFavoritesRepository.getExplicitLocalFavoriteGroups('avatar'),
        localFavoritesRepository.getExplicitLocalFavoriteGroups('friend')
    ]);

    const favoriteLimits = mergeFavoriteLimits(favoriteLimitsResponse?.json);
    const cachedFavoriteGroupsById = {};
    for (const json of remoteFavoriteGroups) {
        const ref = createDefaultFavoriteGroupRef(json);
        if (!ref.id) {
            continue;
        }
        cachedFavoriteGroupsById[ref.id] = ref;
    }

    const favoriteGroups = buildFavoriteGroupsFromLimits(favoriteLimits);
    assignFavoriteGroupMetadata(favoriteGroups, cachedFavoriteGroupsById);

    const remoteSnapshot = buildRemoteFavoriteSnapshot(remoteFavorites, friendRosterById);
    const favoriteGroupIndex = buildFavoriteGroupIndex(favoriteGroups);
    countFavoriteGroups(favoriteGroupIndex, remoteSnapshot.remoteFavoritesById);

    const localWorldDetailsById = ensureLocalDetailFallbacks(
        buildDetailsById(localWorldCacheRows),
        localWorldFavoriteRows.map((row) => row.worldId)
    );
    const localAvatarDetailsById = ensureLocalDetailFallbacks(
        buildDetailsById(localAvatarCacheRows),
        localAvatarFavoriteRows.map((row) => row.avatarId)
    );
    const localWorldSnapshot = buildLocalGroupedIds(
        localWorldFavoriteRows,
        'worldId',
        explicitLocalWorldFavoriteGroups
    );
    const localAvatarSnapshot = buildLocalGroupedIds(
        localAvatarFavoriteRows,
        'avatarId',
        explicitLocalAvatarFavoriteGroups
    );
    const localFriendSnapshot = buildLocalGroupedIds(
        localFriendFavoriteRows,
        'userId',
        explicitLocalFriendFavoriteGroups
    );

    const snapshot = {
        currentUserId: normalizedUserId,
        favoriteLimits,
        favoritesSortOrder: remoteSnapshot.favoritesSortOrder,
        remoteFavoritesById: remoteSnapshot.remoteFavoritesById,
        remoteFavoritesByObjectId: remoteSnapshot.remoteFavoritesByObjectId,
        favoriteFriendIds: remoteSnapshot.favoriteFriendIds,
        groupedFavoriteFriendIdsByGroupKey:
            remoteSnapshot.groupedFavoriteFriendIdsByGroupKey,
        favoriteWorldIds: remoteSnapshot.favoriteWorldIds,
        favoriteAvatarIds: remoteSnapshot.favoriteAvatarIds,
        cachedFavoriteGroupsById,
        favoriteFriendGroups: favoriteGroups.friendGroups,
        favoriteWorldGroups: favoriteGroups.worldGroups,
        favoriteAvatarGroups: favoriteGroups.avatarGroups,
        localWorldFavorites: localWorldSnapshot.groups,
        localAvatarFavorites: localAvatarSnapshot.groups,
        localFriendFavorites: localFriendSnapshot.groups,
        localWorldFavoriteGroups: localWorldSnapshot.groupsList,
        localAvatarFavoriteGroups: localAvatarSnapshot.groupsList,
        localFriendFavoriteGroups: localFriendSnapshot.groupsList,
        localWorldFavoritesList: localWorldSnapshot.list,
        localAvatarFavoritesList: localAvatarSnapshot.list,
        localFriendFavoritesList: localFriendSnapshot.list,
        localWorldDetailsById,
        localAvatarDetailsById,
        detail: buildPendingDetail(displayName, {
            remoteFavoritesById: remoteSnapshot.remoteFavoritesById,
            localWorldFavoritesList: localWorldSnapshot.list,
            localAvatarFavoritesList: localAvatarSnapshot.list,
            localFriendFavoritesList: localFriendSnapshot.list
        })
    };

    if (!isCurrentFavoriteBootstrapTarget(normalizedUserId, currentUserSnapshot)) {
        return {
            userId: normalizedUserId,
            stale: true,
            count: Object.keys(snapshot.remoteFavoritesById).length
        };
    }

    useFavoriteStore.getState().setFavoritesSnapshot(snapshot);
    useSessionStore.getState().setFavoritesLoaded(true);
    syncStartupServicesTask([snapshot.detail]);

    return {
        userId: normalizedUserId,
        stale: false,
        count: Object.keys(snapshot.remoteFavoritesById).length
    };
}

export function bootstrapFavorites(options) {
    const normalizedUserId = normalizeUserId(options?.userId || options?.currentUserSnapshot?.id);
    const currentUserSnapshot =
        options?.currentUserSnapshot && typeof options.currentUserSnapshot === 'object'
            ? options.currentUserSnapshot
            : null;

    if (!normalizedUserId || !currentUserSnapshot) {
        return Promise.reject(
            new Error('Favorites hydration requires an authenticated user id.')
        );
    }

    if (activeHydrations.has(currentUserSnapshot)) {
        return activeHydrations.get(currentUserSnapshot);
    }

    const promise = runFavoriteBootstrap(options)
        .catch((error) => {
            if (isCurrentFavoriteBootstrapTarget(normalizedUserId, currentUserSnapshot)) {
                useRuntimeStore.getState().setStartupTask(
                    'services',
                    'error',
                    error instanceof Error ? error.message : String(error)
                );
                useFavoriteStore.getState().setFavoritesError(
                    error instanceof Error ? error.message : String(error)
                );
                useSessionStore.getState().setFavoritesLoaded(false);
            }

            throw error;
        })
        .finally(() => {
            activeHydrations.delete(currentUserSnapshot);
        });

    activeHydrations.set(currentUserSnapshot, promise);
    return promise;
}
