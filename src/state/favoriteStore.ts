import { create } from 'zustand';

import { createDefaultFavoriteCachedRef } from '@/shared/utils/entityTransforms';

import {
    buildRemoteFavoriteCollections,
    cloneFavoriteLimits,
    createLocalFavoriteGroupState,
    deleteLocalFavoriteGroupState,
    flattenFavoriteGroups,
    getSortedLocalGroupNames,
    hasFavoriteStoreData,
    initialFavoriteStoreState,
    isObjectRecord,
    normalizeFavoriteDetailsById,
    normalizeFavoriteGroupMap,
    normalizeFavoriteGroups,
    normalizeFavoriteRecordMap,
    normalizeFavoriteStoreId,
    normalizeRecord,
    normalizeStringArray,
    recomputeGroupCounts,
    recomputeGroupCountsFromMap,
    removeFromFavoriteGroups,
    renameLocalFavoriteGroupState
} from './favoriteStoreModel';
import type {
    FavoriteDetailsById,
    FavoriteGroupMap,
    FavoriteRecord,
    FavoriteStore
} from './favoriteStoreTypes';

export type {
    FavoriteKind,
    FavoriteSnapshot,
    FavoriteStore,
    FavoriteStoreState,
    LocalFavoriteAction,
    LocalFavoriteGroupAction,
    RenameLocalFavoriteGroupAction
} from './favoriteStoreTypes';
export { DEFAULT_FAVORITE_LIMITS } from './favoriteStoreModel';

export const useFavoriteStore = create<FavoriteStore>((set, get) => ({
    ...initialFavoriteStoreState,
    setFavoritesLoading(currentUserId, detail = '') {
        set((state) => {
            const normalizedCurrentUserId =
                normalizeFavoriteStoreId(currentUserId) || null;
            const isSameUser =
                normalizeFavoriteStoreId(state.currentUserId) ===
                normalizedCurrentUserId;
            const hasFavoriteData = hasFavoriteStoreData(state);

            if (isSameUser && hasFavoriteData) {
                return {
                    ...state,
                    currentUserId: normalizedCurrentUserId,
                    loadStatus: 'running',
                    detail
                };
            }

            return {
                ...initialFavoriteStoreState,
                currentUserId: normalizedCurrentUserId,
                loadStatus: 'running',
                detail
            };
        });
    },
    setFavoritesSnapshot(snapshot = {}) {
        const remoteFavoritesById = normalizeFavoriteRecordMap(
            snapshot.remoteFavoritesById
        );
        const remoteCollections = buildRemoteFavoriteCollections(
            remoteFavoritesById,
            snapshot.favoritesSortOrder
        );
        const hasSnapshotFavoriteFriendIds = Array.isArray(
            snapshot.favoriteFriendIds
        );
        const hasSnapshotGroupedFavoriteFriendIds = isObjectRecord(
            snapshot.groupedFavoriteFriendIdsByGroupKey
        );
        const favoriteFriendIds = hasSnapshotFavoriteFriendIds
            ? normalizeStringArray(snapshot.favoriteFriendIds)
            : remoteCollections.favoriteFriendIds;
        const groupedFavoriteFriendIdsByGroupKey =
            hasSnapshotGroupedFavoriteFriendIds
                ? normalizeFavoriteGroupMap(
                      snapshot.groupedFavoriteFriendIdsByGroupKey
                  )
                : remoteCollections.groupedFavoriteFriendIdsByGroupKey;
        const favoriteFriendGroups = normalizeFavoriteGroups(
            snapshot.favoriteFriendGroups
        );
        const favoriteWorldGroups = normalizeFavoriteGroups(
            snapshot.favoriteWorldGroups
        );
        const favoriteAvatarGroups = normalizeFavoriteGroups(
            snapshot.favoriteAvatarGroups
        );

        set({
            currentUserId:
                normalizeFavoriteStoreId(snapshot.currentUserId) || null,
            loadStatus: 'ready',
            detail: typeof snapshot.detail === 'string' ? snapshot.detail : '',
            lastLoadedAt: new Date().toISOString(),
            favoriteLimits: cloneFavoriteLimits(snapshot.favoriteLimits),
            remoteFavoritesById,
            ...remoteCollections,
            favoriteFriendIds,
            groupedFavoriteFriendIdsByGroupKey,
            cachedFavoriteGroupsById: normalizeRecord(
                snapshot.cachedFavoriteGroupsById
            ),
            favoriteFriendGroups: hasSnapshotGroupedFavoriteFriendIds
                ? recomputeGroupCountsFromMap(
                      favoriteFriendGroups,
                      groupedFavoriteFriendIdsByGroupKey
                  )
                : recomputeGroupCounts(
                      favoriteFriendGroups,
                      remoteFavoritesById
                  ),
            favoriteWorldGroups: recomputeGroupCounts(
                favoriteWorldGroups,
                remoteFavoritesById
            ),
            favoriteAvatarGroups: recomputeGroupCounts(
                favoriteAvatarGroups,
                remoteFavoritesById
            ),
            localWorldFavorites: normalizeFavoriteGroupMap(
                snapshot.localWorldFavorites
            ),
            localAvatarFavorites: normalizeFavoriteGroupMap(
                snapshot.localAvatarFavorites
            ),
            localFriendFavorites: normalizeFavoriteGroupMap(
                snapshot.localFriendFavorites
            ),
            localWorldFavoriteGroups: normalizeStringArray(
                snapshot.localWorldFavoriteGroups
            ),
            localAvatarFavoriteGroups: normalizeStringArray(
                snapshot.localAvatarFavoriteGroups
            ),
            localFriendFavoriteGroups: normalizeStringArray(
                snapshot.localFriendFavoriteGroups
            ),
            localWorldFavoritesList: normalizeStringArray(
                snapshot.localWorldFavoritesList
            ),
            localAvatarFavoritesList: normalizeStringArray(
                snapshot.localAvatarFavoritesList
            ),
            localFriendFavoritesList: normalizeStringArray(
                snapshot.localFriendFavoritesList
            ),
            localWorldDetailsById: normalizeFavoriteDetailsById(
                snapshot.localWorldDetailsById
            ),
            localAvatarDetailsById: normalizeFavoriteDetailsById(
                snapshot.localAvatarDetailsById
            )
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
        set(initialFavoriteStoreState);
    },
    addLocalFavorite({ kind, groupName, entityId, entity }) {
        set((state) => {
            const normalizedGroupName = normalizeFavoriteStoreId(groupName);
            const normalizedEntityId = normalizeFavoriteStoreId(entityId);
            if (!normalizedGroupName || !normalizedEntityId) {
                return state;
            }

            if (kind === 'friend') {
                const localFriendFavorites: FavoriteGroupMap = {
                    ...state.localFriendFavorites,
                    [normalizedGroupName]: Array.from(
                        new Set([
                            normalizedEntityId,
                            ...(Array.isArray(
                                state.localFriendFavorites[normalizedGroupName]
                            )
                                ? state.localFriendFavorites[
                                      normalizedGroupName
                                  ]
                                : [])
                        ])
                    )
                };
                return {
                    ...state,
                    localFriendFavorites,
                    localFriendFavoriteGroups:
                        getSortedLocalGroupNames(localFriendFavorites),
                    localFriendFavoritesList:
                        flattenFavoriteGroups(localFriendFavorites)
                };
            }

            if (kind === 'avatar') {
                const localAvatarFavorites: FavoriteGroupMap = {
                    ...state.localAvatarFavorites,
                    [normalizedGroupName]: Array.from(
                        new Set([
                            normalizedEntityId,
                            ...(Array.isArray(
                                state.localAvatarFavorites[normalizedGroupName]
                            )
                                ? state.localAvatarFavorites[
                                      normalizedGroupName
                                  ]
                                : [])
                        ])
                    )
                };
                return {
                    ...state,
                    localAvatarFavorites,
                    localAvatarFavoriteGroups:
                        getSortedLocalGroupNames(localAvatarFavorites),
                    localAvatarFavoritesList:
                        flattenFavoriteGroups(localAvatarFavorites),
                    localAvatarDetailsById: isObjectRecord(entity)
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
                const localWorldFavorites: FavoriteGroupMap = {
                    ...state.localWorldFavorites,
                    [normalizedGroupName]: Array.from(
                        new Set([
                            normalizedEntityId,
                            ...(Array.isArray(
                                state.localWorldFavorites[normalizedGroupName]
                            )
                                ? state.localWorldFavorites[normalizedGroupName]
                                : [])
                        ])
                    )
                };
                return {
                    ...state,
                    localWorldFavorites,
                    localWorldFavoriteGroups:
                        getSortedLocalGroupNames(localWorldFavorites),
                    localWorldFavoritesList:
                        flattenFavoriteGroups(localWorldFavorites),
                    localWorldDetailsById: isObjectRecord(entity)
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
                    localFriendFavoriteGroups:
                        Object.keys(localFriendFavorites).sort(),
                    localFriendFavoritesList:
                        flattenFavoriteGroups(localFriendFavorites)
                };
            }

            if (kind === 'avatar') {
                const localAvatarFavorites = removeFromFavoriteGroups(
                    state.localAvatarFavorites,
                    groupName,
                    entityId
                );
                const localAvatarFavoritesList =
                    flattenFavoriteGroups(localAvatarFavorites);
                const localAvatarDetailsById: FavoriteDetailsById = {
                    ...state.localAvatarDetailsById
                };
                const normalizedEntityId = normalizeFavoriteStoreId(entityId);
                if (
                    normalizedEntityId &&
                    !localAvatarFavoritesList.includes(normalizedEntityId)
                ) {
                    delete localAvatarDetailsById[normalizedEntityId];
                }
                return {
                    ...state,
                    localAvatarFavorites,
                    localAvatarFavoriteGroups:
                        Object.keys(localAvatarFavorites).sort(),
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
                const localWorldFavoritesList =
                    flattenFavoriteGroups(localWorldFavorites);
                const localWorldDetailsById: FavoriteDetailsById = {
                    ...state.localWorldDetailsById
                };
                const normalizedEntityId = normalizeFavoriteStoreId(entityId);
                if (
                    normalizedEntityId &&
                    !localWorldFavoritesList.includes(normalizedEntityId)
                ) {
                    delete localWorldDetailsById[normalizedEntityId];
                }
                return {
                    ...state,
                    localWorldFavorites,
                    localWorldFavoriteGroups:
                        Object.keys(localWorldFavorites).sort(),
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
                    localFriendFavoriteGroups:
                        getSortedLocalGroupNames(localFriendFavorites)
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
                    localAvatarFavoriteGroups:
                        getSortedLocalGroupNames(localAvatarFavorites)
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
                    localWorldFavoriteGroups:
                        getSortedLocalGroupNames(localWorldFavorites)
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
                    localFriendFavoriteGroups:
                        getSortedLocalGroupNames(localFriendFavorites),
                    localFriendFavoritesList:
                        flattenFavoriteGroups(localFriendFavorites)
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
                    localAvatarFavoriteGroups:
                        getSortedLocalGroupNames(localAvatarFavorites),
                    localAvatarFavoritesList:
                        flattenFavoriteGroups(localAvatarFavorites)
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
                    localWorldFavoriteGroups:
                        getSortedLocalGroupNames(localWorldFavorites),
                    localWorldFavoritesList:
                        flattenFavoriteGroups(localWorldFavorites)
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
                    localFriendFavoriteGroups:
                        getSortedLocalGroupNames(localFriendFavorites),
                    localFriendFavoritesList:
                        flattenFavoriteGroups(localFriendFavorites)
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
                    localAvatarFavoriteGroups:
                        getSortedLocalGroupNames(localAvatarFavorites),
                    localAvatarFavoritesList:
                        flattenFavoriteGroups(localAvatarFavorites)
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
                    localWorldFavoriteGroups:
                        getSortedLocalGroupNames(localWorldFavorites),
                    localWorldFavoritesList:
                        flattenFavoriteGroups(localWorldFavorites)
                };
            }

            return state;
        });
    },
    removeRemoteFavorite(objectId) {
        set((state) => {
            const normalizedObjectId = normalizeFavoriteStoreId(objectId);
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

            const favoriteRecordId = normalizeFavoriteStoreId(ref.id);
            const remoteFavoritesById: Record<string, FavoriteRecord> = {
                ...state.remoteFavoritesById
            };
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
            const ref = createDefaultFavoriteCachedRef(
                isObjectRecord(json) ? json : {}
            ) as FavoriteRecord;
            if (!ref.id || !ref.favoriteId) {
                return state;
            }

            const remoteFavoritesById: Record<string, FavoriteRecord> = {
                ...state.remoteFavoritesById
            };
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
            typeof objectId === 'string'
                ? objectId.trim()
                : String(objectId ?? '').trim();
        if (!normalizedObjectId) {
            return null;
        }
        return get().remoteFavoritesByObjectId[normalizedObjectId] ?? null;
    },
    isInAnyLocalFriendGroup(userId) {
        const normalizedUserId =
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim();
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
