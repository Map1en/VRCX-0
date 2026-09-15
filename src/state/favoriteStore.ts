import { create } from 'zustand';

import type {
    FavoriteGroupMap,
    FavoriteRecord,
    FavoriteStore
} from '@/domain/favorites/types';
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

export type { FavoriteStore } from '@/domain/favorites/types';

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

        const nextState: Partial<FavoriteStore> = {
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
            localAvatarFavorites: normalizeFavoriteGroupMap(
                snapshot.localAvatarFavorites
            ),
            localFriendFavorites: normalizeFavoriteGroupMap(
                snapshot.localFriendFavorites
            ),
            localAvatarFavoriteGroups: normalizeStringArray(
                snapshot.localAvatarFavoriteGroups
            ),
            localFriendFavoriteGroups: normalizeStringArray(
                snapshot.localFriendFavoriteGroups
            ),
            localAvatarFavoritesList: normalizeStringArray(
                snapshot.localAvatarFavoritesList
            ),
            localFriendFavoritesList: normalizeStringArray(
                snapshot.localFriendFavoritesList
            )
        };
        set(nextState);
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
    addLocalFavorite({ kind, groupName, entityId }) {
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
                        flattenFavoriteGroups(localAvatarFavorites)
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
                return {
                    ...state,
                    localAvatarFavorites,
                    localAvatarFavoriteGroups:
                        Object.keys(localAvatarFavorites).sort(),
                    localAvatarFavoritesList
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

            const nextState = {
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
            return nextState;
        });
    },
    addRemoteFavorite(json) {
        set((state) => {
            const ref = createDefaultFavoriteCachedRef(
                isObjectRecord(json) ? json : {}
            );
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

            const nextState = {
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
            return nextState;
        });
    },
    setLocalFavoritesForKind(kind, { localFavorites, localFavoriteGroups }) {
        set((state) => {
            const normalizedFavorites =
                normalizeFavoriteGroupMap(localFavorites);
            const normalizedGroups = Array.from(
                new Set([
                    ...normalizeStringArray(localFavoriteGroups),
                    ...getSortedLocalGroupNames(normalizedFavorites)
                ])
            ).sort();
            const normalizedList = flattenFavoriteGroups(normalizedFavorites);

            if (kind === 'friend') {
                return {
                    ...state,
                    localFriendFavorites: normalizedFavorites,
                    localFriendFavoriteGroups: normalizedGroups,
                    localFriendFavoritesList: normalizedList
                };
            }

            if (kind === 'avatar') {
                return {
                    ...state,
                    localAvatarFavorites: normalizedFavorites,
                    localAvatarFavoriteGroups: normalizedGroups,
                    localAvatarFavoritesList: normalizedList
                };
            }

            return state;
        });
    },
    getRemoteFavoriteByObjectId(objectId) {
        const normalizedObjectId = objectId.trim();
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
