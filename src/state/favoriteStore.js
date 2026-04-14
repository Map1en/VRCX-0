import { create } from 'zustand';

import { createDefaultFavoriteCachedRef } from '@/shared/utils/entityTransforms.js';

export const DEFAULT_FAVORITE_LIMITS = Object.freeze({
    maxFavoriteGroups: Object.freeze({
        avatar: 6,
        friend: 3,
        vrcPlusWorld: 4,
        world: 4
    }),
    maxFavoritesPerGroup: Object.freeze({
        avatar: 50,
        friend: 150,
        vrcPlusWorld: 100,
        world: 100
    })
});

function cloneFavoriteLimits(limits = DEFAULT_FAVORITE_LIMITS) {
    return {
        maxFavoriteGroups: {
            ...DEFAULT_FAVORITE_LIMITS.maxFavoriteGroups,
            ...(limits?.maxFavoriteGroups && typeof limits.maxFavoriteGroups === 'object'
                ? limits.maxFavoriteGroups
                : {})
        },
        maxFavoritesPerGroup: {
            ...DEFAULT_FAVORITE_LIMITS.maxFavoritesPerGroup,
            ...(limits?.maxFavoritesPerGroup && typeof limits.maxFavoritesPerGroup === 'object'
                ? limits.maxFavoritesPerGroup
                : {})
        }
    };
}

const initialState = {
    currentUserId: null,
    loadStatus: 'idle',
    detail: '',
    lastLoadedAt: null,
    favoriteLimits: cloneFavoriteLimits(),
    favoritesSortOrder: [],
    remoteFavoritesById: {},
    remoteFavoritesByObjectId: {},
    favoriteFriendIds: [],
    groupedFavoriteFriendIdsByGroupKey: {},
    favoriteWorldIds: [],
    favoriteAvatarIds: [],
    cachedFavoriteGroupsById: {},
    favoriteFriendGroups: [],
    favoriteWorldGroups: [],
    favoriteAvatarGroups: [],
    localWorldFavorites: {},
    localAvatarFavorites: {},
    localFriendFavorites: {},
    localWorldFavoriteGroups: [],
    localAvatarFavoriteGroups: [],
    localFriendFavoriteGroups: [],
    localWorldFavoritesList: [],
    localAvatarFavoritesList: [],
    localFriendFavoritesList: [],
    localWorldDetailsById: {},
    localAvatarDetailsById: {}
};

function normalizeUserId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function removeFromFavoriteGroups(source, groupName, entityId) {
    const normalizedGroupName = normalizeUserId(groupName);
    const normalizedEntityId = normalizeUserId(entityId);
    const next = {};

    for (const [key, values] of Object.entries(source || {})) {
        const nextValues = Array.isArray(values)
            ? values.filter((value) => normalizeUserId(value) !== normalizedEntityId)
            : [];

        next[key] = key === normalizedGroupName ? nextValues : values;
    }

    return next;
}

function createLocalFavoriteGroupState(source, groupName) {
    const normalizedGroupName = normalizeUserId(groupName);
    if (!normalizedGroupName) {
        return source || {};
    }

    return {
        ...(source || {}),
        [normalizedGroupName]: Array.isArray(source?.[normalizedGroupName])
            ? source[normalizedGroupName]
            : []
    };
}

function renameLocalFavoriteGroupState(source, groupName, newGroupName) {
    const normalizedGroupName = normalizeUserId(groupName);
    const normalizedNewGroupName = normalizeUserId(newGroupName);
    if (!normalizedGroupName || !normalizedNewGroupName || normalizedGroupName === normalizedNewGroupName) {
        return source || {};
    }

    const next = { ...(source || {}) };
    if (next[normalizedNewGroupName]) {
        return next;
    }
    next[normalizedNewGroupName] = Array.isArray(next[normalizedGroupName])
        ? next[normalizedGroupName]
        : [];
    delete next[normalizedGroupName];
    return next;
}

function deleteLocalFavoriteGroupState(source, groupName) {
    const normalizedGroupName = normalizeUserId(groupName);
    if (!normalizedGroupName) {
        return source || {};
    }

    const next = { ...(source || {}) };
    delete next[normalizedGroupName];
    return next;
}

function flattenFavoriteGroups(source) {
    return Array.from(
        new Set(
            Object.values(source || {})
                .flat()
                .map((value) => normalizeUserId(value))
                .filter(Boolean)
        )
    );
}

function getSortedLocalGroupNames(source) {
    return Object.keys(source || {}).sort();
}

function recomputeGroupCounts(groups, remoteFavoritesById) {
    const counts = {};

    for (const favorite of Object.values(remoteFavoritesById || {})) {
        const groupKey = normalizeUserId(favorite?.$groupKey);
        if (!groupKey) {
            continue;
        }
        counts[groupKey] = (counts[groupKey] || 0) + 1;
    }

    return (Array.isArray(groups) ? groups : []).map((group) => {
        return {
            ...group,
            count: counts[normalizeUserId(group?.key)] || 0
        };
    });
}

function buildRemoteFavoriteCollections(remoteFavoritesById, previousSortOrder) {
    const remoteFavoritesByObjectId = {};
    const favoriteFriendIds = [];
    const favoriteWorldIds = [];
    const favoriteAvatarIds = [];
    const groupedFavoriteFriendIdsByGroupKey = {};
    const remainingIds = new Set();

    for (const favorite of Object.values(remoteFavoritesById || {})) {
        const favoriteId = normalizeUserId(favorite?.favoriteId);
        if (!favoriteId) {
            continue;
        }

        remoteFavoritesByObjectId[favoriteId] = favorite;
        remainingIds.add(favoriteId);

        if (favorite.type === 'friend') {
            favoriteFriendIds.push(favoriteId);
            const groupKey = normalizeUserId(favorite.$groupKey);
            if (groupKey) {
                if (!groupedFavoriteFriendIdsByGroupKey[groupKey]) {
                    groupedFavoriteFriendIdsByGroupKey[groupKey] = [];
                }
                groupedFavoriteFriendIdsByGroupKey[groupKey].push(favoriteId);
            }
        } else if (favorite.type === 'avatar') {
            favoriteAvatarIds.push(favoriteId);
        } else if (favorite.type === 'world' || favorite.type === 'vrcPlusWorld') {
            favoriteWorldIds.push(favoriteId);
        }
    }

    const favoritesSortOrder = [];
    const seen = new Set();
    for (const favoriteId of previousSortOrder || []) {
        const normalizedFavoriteId = normalizeUserId(favoriteId);
        if (remainingIds.has(normalizedFavoriteId) && !seen.has(normalizedFavoriteId)) {
            favoritesSortOrder.push(normalizedFavoriteId);
            seen.add(normalizedFavoriteId);
        }
    }
    for (const favoriteId of remainingIds) {
        if (!seen.has(favoriteId)) {
            favoritesSortOrder.push(favoriteId);
        }
    }

    return {
        remoteFavoritesByObjectId,
        favoritesSortOrder,
        favoriteFriendIds,
        favoriteWorldIds,
        favoriteAvatarIds,
        groupedFavoriteFriendIdsByGroupKey
    };
}

export const useFavoriteStore = create((set, get) => ({
    ...initialState,
    setFavoritesLoading(currentUserId, detail = '') {
        set({
            ...initialState,
            currentUserId: normalizeUserId(currentUserId) || null,
            loadStatus: 'running',
            detail
        });
    },
    setFavoritesSnapshot(snapshot = {}) {
        const remoteFavoritesById =
            snapshot.remoteFavoritesById && typeof snapshot.remoteFavoritesById === 'object'
                ? { ...snapshot.remoteFavoritesById }
                : {};
        const remoteCollections = buildRemoteFavoriteCollections(
            remoteFavoritesById,
            snapshot.favoritesSortOrder
        );
        const favoriteFriendGroups = Array.isArray(snapshot.favoriteFriendGroups)
            ? snapshot.favoriteFriendGroups
            : [];
        const favoriteWorldGroups = Array.isArray(snapshot.favoriteWorldGroups)
            ? snapshot.favoriteWorldGroups
            : [];
        const favoriteAvatarGroups = Array.isArray(snapshot.favoriteAvatarGroups)
            ? snapshot.favoriteAvatarGroups
            : [];

        set({
            currentUserId: normalizeUserId(snapshot.currentUserId) || null,
            loadStatus: 'ready',
            detail: snapshot.detail || '',
            lastLoadedAt: new Date().toISOString(),
            favoriteLimits: cloneFavoriteLimits(snapshot.favoriteLimits),
            remoteFavoritesById,
            ...remoteCollections,
            cachedFavoriteGroupsById:
                snapshot.cachedFavoriteGroupsById &&
                typeof snapshot.cachedFavoriteGroupsById === 'object'
                    ? snapshot.cachedFavoriteGroupsById
                    : {},
            favoriteFriendGroups: recomputeGroupCounts(favoriteFriendGroups, remoteFavoritesById),
            favoriteWorldGroups: recomputeGroupCounts(favoriteWorldGroups, remoteFavoritesById),
            favoriteAvatarGroups: recomputeGroupCounts(favoriteAvatarGroups, remoteFavoritesById),
            localWorldFavorites:
                snapshot.localWorldFavorites && typeof snapshot.localWorldFavorites === 'object'
                    ? snapshot.localWorldFavorites
                    : {},
            localAvatarFavorites:
                snapshot.localAvatarFavorites && typeof snapshot.localAvatarFavorites === 'object'
                    ? snapshot.localAvatarFavorites
                    : {},
            localFriendFavorites:
                snapshot.localFriendFavorites && typeof snapshot.localFriendFavorites === 'object'
                    ? snapshot.localFriendFavorites
                    : {},
            localWorldFavoriteGroups: Array.isArray(snapshot.localWorldFavoriteGroups)
                ? snapshot.localWorldFavoriteGroups
                : [],
            localAvatarFavoriteGroups: Array.isArray(snapshot.localAvatarFavoriteGroups)
                ? snapshot.localAvatarFavoriteGroups
                : [],
            localFriendFavoriteGroups: Array.isArray(snapshot.localFriendFavoriteGroups)
                ? snapshot.localFriendFavoriteGroups
                : [],
            localWorldFavoritesList: Array.isArray(snapshot.localWorldFavoritesList)
                ? snapshot.localWorldFavoritesList
                : [],
            localAvatarFavoritesList: Array.isArray(snapshot.localAvatarFavoritesList)
                ? snapshot.localAvatarFavoritesList
                : [],
            localFriendFavoritesList: Array.isArray(snapshot.localFriendFavoritesList)
                ? snapshot.localFriendFavoritesList
                : [],
            localWorldDetailsById:
                snapshot.localWorldDetailsById &&
                typeof snapshot.localWorldDetailsById === 'object'
                    ? snapshot.localWorldDetailsById
                    : {},
            localAvatarDetailsById:
                snapshot.localAvatarDetailsById &&
                typeof snapshot.localAvatarDetailsById === 'object'
                    ? snapshot.localAvatarDetailsById
                    : {}
        });
    },
    setFavoritesError(detail) {
        set((state) => ({
            ...state,
            loadStatus: 'error',
            detail,
            lastLoadedAt: new Date().toISOString()
        }));
    },
    resetFavorites() {
        set(initialState);
    },
    addLocalFavorite({ kind, groupName, entityId, entity }) {
        set((state) => {
            const normalizedGroupName = normalizeUserId(groupName);
            const normalizedEntityId = normalizeUserId(entityId);
            if (!normalizedGroupName || !normalizedEntityId) {
                return state;
            }

            if (kind === 'friend') {
                const localFriendFavorites = {
                    ...state.localFriendFavorites,
                    [normalizedGroupName]: Array.from(
                        new Set([
                            normalizedEntityId,
                            ...(Array.isArray(state.localFriendFavorites[normalizedGroupName])
                                ? state.localFriendFavorites[normalizedGroupName]
                                : [])
                        ])
                    )
                };
                return {
                    ...state,
                    localFriendFavorites,
                    localFriendFavoriteGroups: getSortedLocalGroupNames(localFriendFavorites),
                    localFriendFavoritesList: flattenFavoriteGroups(localFriendFavorites)
                };
            }

            if (kind === 'avatar') {
                const localAvatarFavorites = {
                    ...state.localAvatarFavorites,
                    [normalizedGroupName]: Array.from(
                        new Set([
                            normalizedEntityId,
                            ...(Array.isArray(state.localAvatarFavorites[normalizedGroupName])
                                ? state.localAvatarFavorites[normalizedGroupName]
                                : [])
                        ])
                    )
                };
                return {
                    ...state,
                    localAvatarFavorites,
                    localAvatarFavoriteGroups: getSortedLocalGroupNames(localAvatarFavorites),
                    localAvatarFavoritesList: flattenFavoriteGroups(localAvatarFavorites),
                    localAvatarDetailsById: entity && typeof entity === 'object'
                        ? {
                            ...state.localAvatarDetailsById,
                            [normalizedEntityId]: {
                                id: normalizedEntityId,
                                ...entity
                            }
                        }
                        : state.localAvatarDetailsById
                };
            }

            if (kind === 'world') {
                const localWorldFavorites = {
                    ...state.localWorldFavorites,
                    [normalizedGroupName]: Array.from(
                        new Set([
                            normalizedEntityId,
                            ...(Array.isArray(state.localWorldFavorites[normalizedGroupName])
                                ? state.localWorldFavorites[normalizedGroupName]
                                : [])
                        ])
                    )
                };
                return {
                    ...state,
                    localWorldFavorites,
                    localWorldFavoriteGroups: getSortedLocalGroupNames(localWorldFavorites),
                    localWorldFavoritesList: flattenFavoriteGroups(localWorldFavorites),
                    localWorldDetailsById: entity && typeof entity === 'object'
                        ? {
                            ...state.localWorldDetailsById,
                            [normalizedEntityId]: {
                                id: normalizedEntityId,
                                ...entity
                            }
                        }
                        : state.localWorldDetailsById
                };
            }

            return state;
        });
    },
    removeLocalFavorite({ kind, groupName, entityId }) {
        set((state) => {
            if (kind === 'friend') {
                const localFriendFavorites = removeFromFavoriteGroups(
                    state.localFriendFavorites,
                    groupName,
                    entityId
                );
                return {
                    ...state,
                    localFriendFavorites,
                    localFriendFavoriteGroups: Object.keys(localFriendFavorites).sort(),
                    localFriendFavoritesList: flattenFavoriteGroups(localFriendFavorites)
                };
            }

            if (kind === 'avatar') {
                const localAvatarFavorites = removeFromFavoriteGroups(
                    state.localAvatarFavorites,
                    groupName,
                    entityId
                );
                const localAvatarFavoritesList = flattenFavoriteGroups(localAvatarFavorites);
                const localAvatarDetailsById = { ...state.localAvatarDetailsById };
                const normalizedEntityId = normalizeUserId(entityId);
                if (normalizedEntityId && !localAvatarFavoritesList.includes(normalizedEntityId)) {
                    delete localAvatarDetailsById[normalizedEntityId];
                }
                return {
                    ...state,
                    localAvatarFavorites,
                    localAvatarFavoriteGroups: Object.keys(localAvatarFavorites).sort(),
                    localAvatarFavoritesList,
                    localAvatarDetailsById
                };
            }

            if (kind === 'world') {
                const localWorldFavorites = removeFromFavoriteGroups(
                    state.localWorldFavorites,
                    groupName,
                    entityId
                );
                const localWorldFavoritesList = flattenFavoriteGroups(localWorldFavorites);
                const localWorldDetailsById = { ...state.localWorldDetailsById };
                const normalizedEntityId = normalizeUserId(entityId);
                if (normalizedEntityId && !localWorldFavoritesList.includes(normalizedEntityId)) {
                    delete localWorldDetailsById[normalizedEntityId];
                }
                return {
                    ...state,
                    localWorldFavorites,
                    localWorldFavoriteGroups: Object.keys(localWorldFavorites).sort(),
                    localWorldFavoritesList,
                    localWorldDetailsById
                };
            }

            return state;
        });
    },
    createLocalFavoriteGroup({ kind, groupName }) {
        set((state) => {
            if (kind === 'friend') {
                const localFriendFavorites = createLocalFavoriteGroupState(
                    state.localFriendFavorites,
                    groupName
                );
                return {
                    ...state,
                    localFriendFavorites,
                    localFriendFavoriteGroups: getSortedLocalGroupNames(localFriendFavorites)
                };
            }

            if (kind === 'avatar') {
                const localAvatarFavorites = createLocalFavoriteGroupState(
                    state.localAvatarFavorites,
                    groupName
                );
                return {
                    ...state,
                    localAvatarFavorites,
                    localAvatarFavoriteGroups: getSortedLocalGroupNames(localAvatarFavorites)
                };
            }

            if (kind === 'world') {
                const localWorldFavorites = createLocalFavoriteGroupState(
                    state.localWorldFavorites,
                    groupName
                );
                return {
                    ...state,
                    localWorldFavorites,
                    localWorldFavoriteGroups: getSortedLocalGroupNames(localWorldFavorites)
                };
            }

            return state;
        });
    },
    renameLocalFavoriteGroup({ kind, groupName, newGroupName }) {
        set((state) => {
            if (kind === 'friend') {
                const localFriendFavorites = renameLocalFavoriteGroupState(
                    state.localFriendFavorites,
                    groupName,
                    newGroupName
                );
                return {
                    ...state,
                    localFriendFavorites,
                    localFriendFavoriteGroups: getSortedLocalGroupNames(localFriendFavorites),
                    localFriendFavoritesList: flattenFavoriteGroups(localFriendFavorites)
                };
            }

            if (kind === 'avatar') {
                const localAvatarFavorites = renameLocalFavoriteGroupState(
                    state.localAvatarFavorites,
                    groupName,
                    newGroupName
                );
                return {
                    ...state,
                    localAvatarFavorites,
                    localAvatarFavoriteGroups: getSortedLocalGroupNames(localAvatarFavorites),
                    localAvatarFavoritesList: flattenFavoriteGroups(localAvatarFavorites)
                };
            }

            if (kind === 'world') {
                const localWorldFavorites = renameLocalFavoriteGroupState(
                    state.localWorldFavorites,
                    groupName,
                    newGroupName
                );
                return {
                    ...state,
                    localWorldFavorites,
                    localWorldFavoriteGroups: getSortedLocalGroupNames(localWorldFavorites),
                    localWorldFavoritesList: flattenFavoriteGroups(localWorldFavorites)
                };
            }

            return state;
        });
    },
    deleteLocalFavoriteGroup({ kind, groupName }) {
        set((state) => {
            if (kind === 'friend') {
                const localFriendFavorites = deleteLocalFavoriteGroupState(
                    state.localFriendFavorites,
                    groupName
                );
                return {
                    ...state,
                    localFriendFavorites,
                    localFriendFavoriteGroups: getSortedLocalGroupNames(localFriendFavorites),
                    localFriendFavoritesList: flattenFavoriteGroups(localFriendFavorites)
                };
            }

            if (kind === 'avatar') {
                const localAvatarFavorites = deleteLocalFavoriteGroupState(
                    state.localAvatarFavorites,
                    groupName
                );
                return {
                    ...state,
                    localAvatarFavorites,
                    localAvatarFavoriteGroups: getSortedLocalGroupNames(localAvatarFavorites),
                    localAvatarFavoritesList: flattenFavoriteGroups(localAvatarFavorites)
                };
            }

            if (kind === 'world') {
                const localWorldFavorites = deleteLocalFavoriteGroupState(
                    state.localWorldFavorites,
                    groupName
                );
                return {
                    ...state,
                    localWorldFavorites,
                    localWorldFavoriteGroups: getSortedLocalGroupNames(localWorldFavorites),
                    localWorldFavoritesList: flattenFavoriteGroups(localWorldFavorites)
                };
            }

            return state;
        });
    },
    removeRemoteFavorite(objectId) {
        set((state) => {
            const normalizedObjectId = normalizeUserId(objectId);
            if (!normalizedObjectId) {
                return state;
            }

            const ref =
                state.remoteFavoritesByObjectId[normalizedObjectId] ||
                state.remoteFavoritesById[normalizedObjectId] ||
                null;
            if (!ref?.favoriteId) {
                return state;
            }

            const favoriteRecordId = normalizeUserId(ref.id);
            const remoteFavoritesById = { ...state.remoteFavoritesById };
            if (favoriteRecordId) {
                delete remoteFavoritesById[favoriteRecordId];
            }

            const remoteCollections = buildRemoteFavoriteCollections(
                remoteFavoritesById,
                state.favoritesSortOrder
            );

            return {
                ...state,
                remoteFavoritesById,
                ...remoteCollections,
                favoriteFriendGroups: recomputeGroupCounts(
                    state.favoriteFriendGroups,
                    remoteFavoritesById
                ),
                favoriteWorldGroups: recomputeGroupCounts(
                    state.favoriteWorldGroups,
                    remoteFavoritesById
                ),
                favoriteAvatarGroups: recomputeGroupCounts(
                    state.favoriteAvatarGroups,
                    remoteFavoritesById
                )
            };
        });
    },
    addRemoteFavorite(json) {
        set((state) => {
            const ref = createDefaultFavoriteCachedRef(json ?? {});
            if (!ref.id || !ref.favoriteId) {
                return state;
            }

            const remoteFavoritesById = { ...state.remoteFavoritesById };
            const previousRef = state.remoteFavoritesByObjectId[ref.favoriteId];
            if (previousRef?.id && previousRef.id !== ref.id) {
                delete remoteFavoritesById[previousRef.id];
            }
            remoteFavoritesById[ref.id] = ref;

            const remoteCollections = buildRemoteFavoriteCollections(
                remoteFavoritesById,
                [ref.favoriteId, ...state.favoritesSortOrder]
            );

            return {
                ...state,
                remoteFavoritesById,
                ...remoteCollections,
                favoriteFriendGroups: recomputeGroupCounts(
                    state.favoriteFriendGroups,
                    remoteFavoritesById
                ),
                favoriteWorldGroups: recomputeGroupCounts(
                    state.favoriteWorldGroups,
                    remoteFavoritesById
                ),
                favoriteAvatarGroups: recomputeGroupCounts(
                    state.favoriteAvatarGroups,
                    remoteFavoritesById
                )
            };
        });
    },
    getRemoteFavoriteByObjectId(objectId) {
        const normalizedObjectId =
            typeof objectId === 'string' ? objectId.trim() : String(objectId ?? '').trim();
        if (!normalizedObjectId) {
            return null;
        }
        return get().remoteFavoritesByObjectId[normalizedObjectId] ?? null;
    },
    isInAnyLocalFriendGroup(userId) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            return false;
        }

        const localFriendFavorites = get().localFriendFavorites;
        for (const values of Object.values(localFriendFavorites)) {
            if (Array.isArray(values) && values.includes(normalizedUserId)) {
                return true;
            }
        }
        return false;
    }
}));
