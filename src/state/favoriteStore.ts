import { create } from 'zustand';

import type {
    FavoriteGroupMap,
    FavoriteRecord,
    FavoriteStore,
    FavoriteStoreState,
    LocalFavoriteGroup,
    StoredLocalFavoriteKind
} from '@/domain/favorites/types';
import { createDefaultFavoriteCachedRef } from '@/shared/utils/entityTransforms';

import {
    buildRemoteFavoriteCollections,
    cloneFavoriteLimits,
    flattenFavoriteGroups,
    hasFavoriteStoreData,
    initialFavoriteStoreState,
    isObjectRecord,
    normalizeFavoriteGroupMap,
    normalizeFavoriteGroups,
    normalizeFavoriteRecordMap,
    normalizeFavoriteStoreId,
    normalizeLocalFavoriteGroups,
    normalizeRecord,
    normalizeStringArray,
    recomputeGroupCounts,
    recomputeGroupCountsFromMap,
    withLocalFavoriteGroupKeys
} from './favoriteStoreModel';

export type { FavoriteStore } from '@/domain/favorites/types';

type LocalFavoriteUpdate = {
    favorites: FavoriteGroupMap;
    groups: LocalFavoriteGroup[];
};

function updateLocalFavorites(
    state: FavoriteStoreState,
    kind: StoredLocalFavoriteKind,
    update: (
        favorites: FavoriteGroupMap,
        groups: LocalFavoriteGroup[]
    ) => LocalFavoriteUpdate
): FavoriteStoreState {
    if (kind !== 'friend' && kind !== 'avatar') {
        return state;
    }
    const current =
        kind === 'friend'
            ? {
                  favorites: state.localFriendFavorites,
                  groups: state.localFriendFavoriteGroups
              }
            : {
                  favorites: state.localAvatarFavorites,
                  groups: state.localAvatarFavoriteGroups
              };
    const next = update(current.favorites, current.groups);
    if (
        next.favorites === current.favorites &&
        next.groups === current.groups
    ) {
        return state;
    }
    const sameMembers =
        next.favorites === current.favorites &&
        next.groups.length === current.groups.length &&
        next.groups.every(
            (group, index) => group.id === current.groups[index].id
        );
    if (sameMembers) {
        return kind === 'friend'
            ? { ...state, localFriendFavoriteGroups: next.groups }
            : { ...state, localAvatarFavoriteGroups: next.groups };
    }
    const favorites = withLocalFavoriteGroupKeys(next.groups, next.favorites);
    const list = flattenFavoriteGroups(favorites);
    return kind === 'friend'
        ? {
              ...state,
              localFriendFavorites: favorites,
              localFriendFavoriteGroups: next.groups,
              localFriendFavoritesList: list
          }
        : {
              ...state,
              localAvatarFavorites: favorites,
              localAvatarFavoriteGroups: next.groups,
              localAvatarFavoritesList: list
          };
}

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
        const localAvatarFavoriteGroups = normalizeLocalFavoriteGroups(
            snapshot.localAvatarFavoriteGroups
        );
        const localFriendFavoriteGroups = normalizeLocalFavoriteGroups(
            snapshot.localFriendFavoriteGroups
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
            localAvatarFavorites: withLocalFavoriteGroupKeys(
                localAvatarFavoriteGroups,
                normalizeFavoriteGroupMap(snapshot.localAvatarFavorites)
            ),
            localFriendFavorites: withLocalFavoriteGroupKeys(
                localFriendFavoriteGroups,
                normalizeFavoriteGroupMap(snapshot.localFriendFavorites)
            ),
            localAvatarFavoriteGroups,
            localFriendFavoriteGroups,
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
    addLocalFavorite({ kind, groupId, entityId }) {
        const normalizedEntityId = normalizeFavoriteStoreId(entityId);
        if (!normalizedEntityId) {
            return;
        }
        set((state) =>
            updateLocalFavorites(state, kind, (favorites, groups) => {
                const key = String(groupId);
                if (!(key in favorites)) {
                    return { favorites, groups };
                }
                return {
                    favorites: {
                        ...favorites,
                        [key]: Array.from(
                            new Set([normalizedEntityId, ...favorites[key]])
                        )
                    },
                    groups
                };
            })
        );
    },
    removeLocalFavorite({ kind, groupId, entityId }) {
        const normalizedEntityId = normalizeFavoriteStoreId(entityId);
        set((state) =>
            updateLocalFavorites(state, kind, (favorites, groups) => {
                const key = String(groupId);
                if (!(key in favorites)) {
                    return { favorites, groups };
                }
                return {
                    favorites: {
                        ...favorites,
                        [key]: favorites[key].filter(
                            (value) => value !== normalizedEntityId
                        )
                    },
                    groups
                };
            })
        );
    },
    createLocalFavoriteGroup(group) {
        const kind = group.kind;
        if (kind === 'world') {
            return;
        }
        set((state) =>
            updateLocalFavorites(state, kind, (favorites, groups) =>
                groups.some((existing) => existing.id === group.id)
                    ? { favorites, groups }
                    : { favorites, groups: [...groups, group] }
            )
        );
    },
    renameLocalFavoriteGroup({ kind, groupId, name }) {
        const normalizedName = normalizeFavoriteStoreId(name);
        if (!normalizedName) {
            return;
        }
        set((state) =>
            updateLocalFavorites(state, kind, (favorites, groups) => ({
                favorites,
                groups: groups.map((group) =>
                    group.id === groupId
                        ? { ...group, name: normalizedName }
                        : group
                )
            }))
        );
    },
    deleteLocalFavoriteGroup({ kind, groupId }) {
        set((state) =>
            updateLocalFavorites(state, kind, (favorites, groups) => ({
                favorites,
                groups: groups.filter((group) => group.id !== groupId)
            }))
        );
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
        set((state) =>
            updateLocalFavorites(state, kind, () => ({
                favorites: localFavorites,
                groups: localFavoriteGroups
            }))
        );
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
