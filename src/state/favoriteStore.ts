import { create } from 'zustand';

import { createDefaultFavoriteCachedRef } from '@/shared/utils/entityTransforms';

export type FavoriteKind = 'friend' | 'avatar' | 'world';
type LoadStatus = 'idle' | 'running' | 'ready' | 'error';
type FavoriteLimits = {
    maxFavoriteGroups: Record<string, unknown>;
    maxFavoritesPerGroup: Record<string, unknown>;
};
type FavoriteRecord = Record<string, unknown> & {
    id?: string;
    type?: string;
    favoriteId?: string;
    tags?: unknown[];
    $groupKey?: string;
};
type FavoriteGroup = Record<string, unknown> & {
    key?: unknown;
    count?: number;
};
type FavoriteGroupMap = Record<string, string[]>;
type FavoriteDetailsById = Record<string, Record<string, unknown>>;
export type FavoriteSnapshot = Partial<Record<keyof FavoriteStoreState, unknown>> &
    Record<string, unknown> & {
        favoriteLimits?: unknown;
    };
export type LocalFavoriteGroupAction = {
    kind: FavoriteKind;
    groupName: unknown;
};
export type LocalFavoriteAction = LocalFavoriteGroupAction & {
    entityId?: unknown;
    entity?: unknown;
};
export type RenameLocalFavoriteGroupAction = LocalFavoriteGroupAction & {
    newGroupName?: unknown;
};
type RemoteFavoriteCollections = {
    remoteFavoritesByObjectId: Record<string, FavoriteRecord>;
    favoritesSortOrder: string[];
    favoriteFriendIds: string[];
    favoriteWorldIds: string[];
    favoriteAvatarIds: string[];
    groupedFavoriteFriendIdsByGroupKey: Record<string, string[]>;
};
export type FavoriteStoreState = {
    currentUserId: string | null;
    loadStatus: LoadStatus;
    detail: string;
    lastLoadedAt: string | null;
    favoriteLimits: FavoriteLimits;
    favoritesSortOrder: string[];
    remoteFavoritesById: Record<string, FavoriteRecord>;
    remoteFavoritesByObjectId: Record<string, FavoriteRecord>;
    favoriteFriendIds: string[];
    groupedFavoriteFriendIdsByGroupKey: Record<string, string[]>;
    favoriteWorldIds: string[];
    favoriteAvatarIds: string[];
    cachedFavoriteGroupsById: Record<string, unknown>;
    favoriteFriendGroups: FavoriteGroup[];
    favoriteWorldGroups: FavoriteGroup[];
    favoriteAvatarGroups: FavoriteGroup[];
    localWorldFavorites: FavoriteGroupMap;
    localAvatarFavorites: FavoriteGroupMap;
    localFriendFavorites: FavoriteGroupMap;
    localWorldFavoriteGroups: string[];
    localAvatarFavoriteGroups: string[];
    localFriendFavoriteGroups: string[];
    localWorldFavoritesList: string[];
    localAvatarFavoritesList: string[];
    localFriendFavoritesList: string[];
    localWorldDetailsById: FavoriteDetailsById;
    localAvatarDetailsById: FavoriteDetailsById;
};
export type FavoriteStore = FavoriteStoreState & {
    setFavoritesLoading(currentUserId: unknown, detail?: string): void;
    setFavoritesSnapshot(snapshot?: FavoriteSnapshot): void;
    setFavoritesError(detail: string): void;
    resetFavorites(): void;
    addLocalFavorite(action: LocalFavoriteAction): void;
    removeLocalFavorite(action: LocalFavoriteAction): void;
    createLocalFavoriteGroup(action: LocalFavoriteGroupAction): void;
    renameLocalFavoriteGroup(action: RenameLocalFavoriteGroupAction): void;
    deleteLocalFavoriteGroup(action: LocalFavoriteGroupAction): void;
    removeRemoteFavorite(objectId: unknown): void;
    addRemoteFavorite(json?: Record<string, unknown> | null): void;
    getRemoteFavoriteByObjectId(objectId: unknown): FavoriteRecord | null;
    isInAnyLocalFriendGroup(userId: unknown): boolean;
};

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
}) satisfies FavoriteLimits;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneFavoriteLimits(limits: unknown = DEFAULT_FAVORITE_LIMITS): FavoriteLimits {
    const source = isObjectRecord(limits) ? limits : {};
    const maxFavoriteGroups = isObjectRecord(source.maxFavoriteGroups)
        ? source.maxFavoriteGroups
        : {};
    const maxFavoritesPerGroup = isObjectRecord(source.maxFavoritesPerGroup)
        ? source.maxFavoritesPerGroup
        : {};

    return {
        maxFavoriteGroups: {
            ...DEFAULT_FAVORITE_LIMITS.maxFavoriteGroups,
            ...maxFavoriteGroups
        },
        maxFavoritesPerGroup: {
            ...DEFAULT_FAVORITE_LIMITS.maxFavoritesPerGroup,
            ...maxFavoritesPerGroup
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
} satisfies FavoriteStoreState;

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function removeFromFavoriteGroups(
    source: FavoriteGroupMap | null | undefined,
    groupName: unknown,
    entityId: unknown
): FavoriteGroupMap {
    const normalizedGroupName = normalizeUserId(groupName);
    const normalizedEntityId = normalizeUserId(entityId);
    const next: FavoriteGroupMap = {};

    for (const [key, values] of Object.entries(source || {})) {
        const nextValues = Array.isArray(values)
            ? values.filter(
                  (value) => normalizeUserId(value) !== normalizedEntityId
              )
            : [];

        next[key] = key === normalizedGroupName ? nextValues : values;
    }

    return next;
}

function createLocalFavoriteGroupState(
    source: FavoriteGroupMap | null | undefined,
    groupName: unknown
): FavoriteGroupMap {
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

function renameLocalFavoriteGroupState(
    source: FavoriteGroupMap | null | undefined,
    groupName: unknown,
    newGroupName: unknown
): FavoriteGroupMap {
    const normalizedGroupName = normalizeUserId(groupName);
    const normalizedNewGroupName = normalizeUserId(newGroupName);
    if (
        !normalizedGroupName ||
        !normalizedNewGroupName ||
        normalizedGroupName === normalizedNewGroupName
    ) {
        return source || {};
    }

    const next: FavoriteGroupMap = { ...(source || {}) };
    if (next[normalizedNewGroupName]) {
        return next;
    }
    next[normalizedNewGroupName] = Array.isArray(next[normalizedGroupName])
        ? next[normalizedGroupName]
        : [];
    delete next[normalizedGroupName];
    return next;
}

function deleteLocalFavoriteGroupState(
    source: FavoriteGroupMap | null | undefined,
    groupName: unknown
): FavoriteGroupMap {
    const normalizedGroupName = normalizeUserId(groupName);
    if (!normalizedGroupName) {
        return source || {};
    }

    const next: FavoriteGroupMap = { ...(source || {}) };
    delete next[normalizedGroupName];
    return next;
}

function flattenFavoriteGroups(source: FavoriteGroupMap | null | undefined): string[] {
    return Array.from(
        new Set(
            Object.values(source || {})
                .flat()
                .map((value) => normalizeUserId(value))
                .filter(Boolean)
        )
    );
}

function getSortedLocalGroupNames(source: FavoriteGroupMap | null | undefined): string[] {
    return Object.keys(source || {}).sort();
}

function normalizeStringArray(source: unknown): string[] {
    return Array.isArray(source)
        ? source.map((value) => normalizeUserId(value)).filter(Boolean)
        : [];
}

function normalizeFavoriteGroupMap(source: unknown): FavoriteGroupMap {
    if (!isObjectRecord(source)) {
        return {};
    }

    const next: FavoriteGroupMap = {};
    for (const [key, values] of Object.entries(source)) {
        const groupKey = normalizeUserId(key);
        if (!groupKey) {
            continue;
        }
        next[groupKey] = normalizeStringArray(values);
    }
    return next;
}

function normalizeRecord(source: unknown): Record<string, unknown> {
    return isObjectRecord(source) ? { ...source } : {};
}

function normalizeFavoriteRecordMap(
    source: unknown
): Record<string, FavoriteRecord> {
    if (!isObjectRecord(source)) {
        return {};
    }

    const next: Record<string, FavoriteRecord> = {};
    for (const [key, value] of Object.entries(source)) {
        const recordKey = normalizeUserId(key);
        if (!recordKey || !isObjectRecord(value)) {
            continue;
        }
        next[recordKey] = { ...value } as FavoriteRecord;
    }
    return next;
}

function normalizeFavoriteGroups(source: unknown): FavoriteGroup[] {
    return Array.isArray(source)
        ? source
              .filter(isObjectRecord)
              .map((group) => ({ ...group }) as FavoriteGroup)
        : [];
}

function normalizeFavoriteDetailsById(source: unknown): FavoriteDetailsById {
    if (!isObjectRecord(source)) {
        return {};
    }

    const next: FavoriteDetailsById = {};
    for (const [key, value] of Object.entries(source)) {
        const normalizedKey = normalizeUserId(key);
        if (!normalizedKey || !isObjectRecord(value)) {
            continue;
        }
        next[normalizedKey] = { ...value };
    }
    return next;
}

function recomputeGroupCounts(
    groups: unknown,
    remoteFavoritesById: Record<string, FavoriteRecord>
): FavoriteGroup[] {
    const counts: Record<string, number> = {};

    for (const favorite of Object.values(remoteFavoritesById || {})) {
        const groupKey = normalizeUserId(favorite?.$groupKey);
        if (!groupKey) {
            continue;
        }
        counts[groupKey] = (counts[groupKey] || 0) + 1;
    }

    return normalizeFavoriteGroups(groups).map((groupRecord) => {
        return {
            ...groupRecord,
            count: counts[normalizeUserId(groupRecord.key)] || 0
        };
    });
}

function recomputeGroupCountsFromMap(
    groups: unknown,
    groupedIdsByGroupKey: FavoriteGroupMap
): FavoriteGroup[] {
    return normalizeFavoriteGroups(groups).map((groupRecord) => {
        return {
            ...groupRecord,
            count:
                groupedIdsByGroupKey[normalizeUserId(groupRecord.key)]
                    ?.length || 0
        };
    });
}

function buildRemoteFavoriteCollections(
    remoteFavoritesById: Record<string, FavoriteRecord>,
    previousSortOrder: unknown
): RemoteFavoriteCollections {
    const remoteFavoritesByObjectId: Record<string, FavoriteRecord> = {};
    const favoriteFriendIds: string[] = [];
    const favoriteWorldIds: string[] = [];
    const favoriteAvatarIds: string[] = [];
    const groupedFavoriteFriendIdsByGroupKey: Record<string, string[]> = {};
    const remainingIds = new Set<string>();

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
        } else if (
            favorite.type === 'world' ||
            favorite.type === 'vrcPlusWorld'
        ) {
            favoriteWorldIds.push(favoriteId);
        }
    }

    const favoritesSortOrder: string[] = [];
    const seen = new Set<string>();
    for (const favoriteId of Array.isArray(previousSortOrder)
        ? previousSortOrder
        : []) {
        const normalizedFavoriteId = normalizeUserId(favoriteId);
        if (
            remainingIds.has(normalizedFavoriteId) &&
            !seen.has(normalizedFavoriteId)
        ) {
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

export const useFavoriteStore = create<FavoriteStore>((set, get) => ({
    ...initialState,
    setFavoritesLoading(currentUserId, detail = '') {
        set((state) => {
            const normalizedCurrentUserId =
                normalizeUserId(currentUserId) || null;
            const isSameUser =
                normalizeUserId(state.currentUserId) ===
                normalizedCurrentUserId;
            const hasFavoriteData =
                Object.keys(state.remoteFavoritesById || {}).length > 0 ||
                Object.keys(state.cachedFavoriteGroupsById || {}).length > 0 ||
                state.favoriteFriendIds.length > 0 ||
                state.favoriteWorldIds.length > 0 ||
                state.favoriteAvatarIds.length > 0 ||
                state.favoriteFriendGroups.length > 0 ||
                state.favoriteWorldGroups.length > 0 ||
                state.favoriteAvatarGroups.length > 0 ||
                Object.keys(state.localFriendFavorites || {}).length > 0 ||
                Object.keys(state.localWorldFavorites || {}).length > 0 ||
                Object.keys(state.localAvatarFavorites || {}).length > 0 ||
                state.localFriendFavoriteGroups.length > 0 ||
                state.localWorldFavoriteGroups.length > 0 ||
                state.localAvatarFavoriteGroups.length > 0;

            if (isSameUser && hasFavoriteData) {
                return {
                    ...state,
                    currentUserId: normalizedCurrentUserId,
                    loadStatus: 'running',
                    detail
                };
            }

            return {
                ...initialState,
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
            currentUserId: normalizeUserId(snapshot.currentUserId) || null,
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
                    localAvatarDetailsById:
                        isObjectRecord(entity)
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
                    localWorldDetailsById:
                        isObjectRecord(entity)
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
                const normalizedEntityId = normalizeUserId(entityId);
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
                const normalizedEntityId = normalizeUserId(entityId);
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
