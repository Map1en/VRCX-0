import type {
    FavoriteCachedGroup,
    FavoriteGroup,
    FavoriteGroupMap,
    FavoriteLimits,
    FavoriteRecord,
    FavoriteStoreState,
    RemoteFavoriteCollections
} from '@/domain/favorites/types';

const DEFAULT_FAVORITE_LIMITS = Object.freeze({
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

export function isObjectRecord(
    value: unknown
): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function copyUnknownFields(
    source: Record<string, unknown>,
    knownFields: ReadonlySet<string>
): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
        if (!knownFields.has(key)) {
            next[key] = value;
        }
    }
    return next;
}

function normalizeLimitRecord(source: unknown): Record<string, number> {
    if (!isObjectRecord(source)) {
        return {};
    }

    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            next[key] = value;
        }
    }
    return next;
}

export function cloneFavoriteLimits(
    limits: unknown = DEFAULT_FAVORITE_LIMITS
): FavoriteLimits {
    const source = isObjectRecord(limits) ? limits : {};
    const maxFavoriteGroups = normalizeLimitRecord(source.maxFavoriteGroups);
    const maxFavoritesPerGroup = normalizeLimitRecord(
        source.maxFavoritesPerGroup
    );

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

export const initialFavoriteStoreState: FavoriteStoreState = {
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
    localAvatarFavorites: {},
    localFriendFavorites: {},
    localAvatarFavoriteGroups: [],
    localFriendFavoriteGroups: [],
    localAvatarFavoritesList: [],
    localFriendFavoritesList: []
};

export function normalizeFavoriteStoreId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function removeFromFavoriteGroups(
    source: FavoriteGroupMap | null | undefined,
    groupName: string,
    entityId: string
): FavoriteGroupMap {
    const normalizedGroupName = normalizeFavoriteStoreId(groupName);
    const normalizedEntityId = normalizeFavoriteStoreId(entityId);
    const next: FavoriteGroupMap = {};

    for (const [key, values] of Object.entries(source || {})) {
        const nextValues = Array.isArray(values)
            ? values.filter(
                  (value) =>
                      normalizeFavoriteStoreId(value) !== normalizedEntityId
              )
            : [];

        next[key] = key === normalizedGroupName ? nextValues : values;
    }

    return next;
}

export function createLocalFavoriteGroupState(
    source: FavoriteGroupMap | null | undefined,
    groupName: string
): FavoriteGroupMap {
    const normalizedGroupName = normalizeFavoriteStoreId(groupName);
    if (!normalizedGroupName) {
        return source || {};
    }

    return {
        ...source,
        [normalizedGroupName]: Array.isArray(source?.[normalizedGroupName])
            ? source[normalizedGroupName]
            : []
    };
}

export function renameLocalFavoriteGroupState(
    source: FavoriteGroupMap | null | undefined,
    groupName: string,
    newGroupName: string
): FavoriteGroupMap {
    const normalizedGroupName = normalizeFavoriteStoreId(groupName);
    const normalizedNewGroupName = normalizeFavoriteStoreId(newGroupName);
    if (
        !normalizedGroupName ||
        !normalizedNewGroupName ||
        normalizedGroupName === normalizedNewGroupName
    ) {
        return source || {};
    }

    const next: FavoriteGroupMap = { ...source };
    if (next[normalizedNewGroupName]) {
        return next;
    }
    next[normalizedNewGroupName] = Array.isArray(next[normalizedGroupName])
        ? next[normalizedGroupName]
        : [];
    delete next[normalizedGroupName];
    return next;
}

export function deleteLocalFavoriteGroupState(
    source: FavoriteGroupMap | null | undefined,
    groupName: string
): FavoriteGroupMap {
    const normalizedGroupName = normalizeFavoriteStoreId(groupName);
    if (!normalizedGroupName) {
        return source || {};
    }

    const next: FavoriteGroupMap = { ...source };
    delete next[normalizedGroupName];
    return next;
}

export function flattenFavoriteGroups(
    source: FavoriteGroupMap | null | undefined
): string[] {
    return Array.from(
        new Set(
            Object.values(source || {})
                .flat()
                .map((value) => normalizeFavoriteStoreId(value))
                .filter(Boolean)
        )
    );
}

export function getSortedLocalGroupNames(
    source: FavoriteGroupMap | null | undefined
): string[] {
    return Object.keys(source || {}).sort();
}

export function normalizeStringArray(source: unknown): string[] {
    return Array.isArray(source)
        ? source.map((value) => normalizeFavoriteStoreId(value)).filter(Boolean)
        : [];
}

function normalizeStringArrayField(value: unknown): string[] | undefined {
    return Array.isArray(value)
        ? value.map((entry) => normalizeFavoriteStoreId(entry)).filter(Boolean)
        : undefined;
}

const FAVORITE_CACHED_GROUP_FIELDS = new Set([
    'displayName',
    'id',
    'name',
    'ownerDisplayName',
    'ownerId',
    'tags',
    'type',
    'visibility'
]);

const FAVORITE_RECORD_FIELDS = new Set([
    '$groupKey',
    'favoriteId',
    'id',
    'tags',
    'type'
]);

const FAVORITE_GROUP_FIELDS = new Set([
    'assign',
    'capacity',
    'count',
    'displayName',
    'key',
    'name',
    'tags',
    'type',
    'visibility'
]);

export function normalizeFavoriteGroupMap(source: unknown): FavoriteGroupMap {
    if (!isObjectRecord(source)) {
        return {};
    }

    const next: FavoriteGroupMap = {};
    for (const [key, values] of Object.entries(source)) {
        const groupKey = normalizeFavoriteStoreId(key);
        if (!groupKey) {
            continue;
        }
        next[groupKey] = normalizeStringArray(values);
    }
    return next;
}

export function normalizeRecord(
    source: unknown
): Record<string, FavoriteCachedGroup> {
    if (!isObjectRecord(source)) {
        return {};
    }

    const next: Record<string, FavoriteCachedGroup> = {};
    for (const [key, value] of Object.entries(source)) {
        const normalizedKey = normalizeFavoriteStoreId(key);
        if (!normalizedKey || !isObjectRecord(value)) {
            continue;
        }
        const record: FavoriteCachedGroup = copyUnknownFields(
            value,
            FAVORITE_CACHED_GROUP_FIELDS
        );
        if (typeof value.displayName === 'string') {
            record.displayName = value.displayName;
        }
        if (typeof value.id === 'string') {
            record.id = value.id;
        }
        if (typeof value.name === 'string') {
            record.name = value.name;
        }
        if (typeof value.ownerDisplayName === 'string') {
            record.ownerDisplayName = value.ownerDisplayName;
        }
        if (typeof value.ownerId === 'string') {
            record.ownerId = value.ownerId;
        }
        const tags = normalizeStringArrayField(value.tags);
        if (tags) {
            record.tags = tags;
        }
        if (typeof value.type === 'string') {
            record.type = value.type;
        }
        if (typeof value.visibility === 'string') {
            record.visibility = value.visibility;
        }
        next[normalizedKey] = record;
    }
    return next;
}

export function normalizeFavoriteRecordMap(
    source: unknown
): Record<string, FavoriteRecord> {
    if (!isObjectRecord(source)) {
        return {};
    }

    const next: Record<string, FavoriteRecord> = {};
    for (const [key, value] of Object.entries(source)) {
        const recordKey = normalizeFavoriteStoreId(key);
        if (!recordKey || !isObjectRecord(value)) {
            continue;
        }
        const record: FavoriteRecord = copyUnknownFields(
            value,
            FAVORITE_RECORD_FIELDS
        );
        if (typeof value.id === 'string') {
            record.id = value.id;
        }
        if (typeof value.type === 'string') {
            record.type = value.type;
        }
        if (typeof value.favoriteId === 'string') {
            record.favoriteId = value.favoriteId;
        }
        if (typeof value.$groupKey === 'string') {
            record.$groupKey = value.$groupKey;
        }
        const tags = normalizeStringArrayField(value.tags);
        if (tags) {
            record.tags = tags;
        }
        next[recordKey] = record;
    }
    return next;
}

export function normalizeFavoriteGroups(source: unknown): FavoriteGroup[] {
    return Array.isArray(source)
        ? source.filter(isObjectRecord).map((group) => {
              const groupRecord: FavoriteGroup = copyUnknownFields(
                  group,
                  FAVORITE_GROUP_FIELDS
              );
              if (typeof group.key === 'string') {
                  groupRecord.key = group.key;
              }
              if (typeof group.count === 'number') {
                  groupRecord.count = group.count;
              }
              if (typeof group.assign === 'boolean') {
                  groupRecord.assign = group.assign;
              }
              if (typeof group.capacity === 'number') {
                  groupRecord.capacity = group.capacity;
              }
              if (typeof group.displayName === 'string') {
                  groupRecord.displayName = group.displayName;
              }
              if (typeof group.name === 'string') {
                  groupRecord.name = group.name;
              }
              if (typeof group.type === 'string') {
                  groupRecord.type = group.type;
              }
              if (typeof group.visibility === 'string') {
                  groupRecord.visibility = group.visibility;
              }
              const tags = normalizeStringArrayField(group.tags);
              if (tags) {
                  groupRecord.tags = tags;
              }
              return groupRecord;
          })
        : [];
}

export function recomputeGroupCounts(
    groups: unknown,
    remoteFavoritesById: Record<string, FavoriteRecord>
): FavoriteGroup[] {
    const counts: Record<string, number> = {};

    for (const favorite of Object.values(remoteFavoritesById || {})) {
        const groupKey = normalizeFavoriteStoreId(favorite?.$groupKey);
        if (!groupKey) {
            continue;
        }
        counts[groupKey] = (counts[groupKey] || 0) + 1;
    }

    return normalizeFavoriteGroups(groups).map((groupRecord) => {
        return {
            ...groupRecord,
            count: counts[normalizeFavoriteStoreId(groupRecord.key)] || 0
        };
    });
}

export function recomputeGroupCountsFromMap(
    groups: unknown,
    groupedIdsByGroupKey: FavoriteGroupMap
): FavoriteGroup[] {
    return normalizeFavoriteGroups(groups).map((groupRecord) => {
        return {
            ...groupRecord,
            count:
                groupedIdsByGroupKey[normalizeFavoriteStoreId(groupRecord.key)]
                    ?.length || 0
        };
    });
}

export function buildRemoteFavoriteCollections(
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
        const favoriteId = normalizeFavoriteStoreId(favorite?.favoriteId);
        if (!favoriteId) {
            continue;
        }

        remoteFavoritesByObjectId[favoriteId] = favorite;
        remainingIds.add(favoriteId);

        if (favorite.type === 'friend') {
            favoriteFriendIds.push(favoriteId);
            const groupKey = normalizeFavoriteStoreId(favorite.$groupKey);
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
        const normalizedFavoriteId = normalizeFavoriteStoreId(favoriteId);
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

export function hasFavoriteStoreData(state: FavoriteStoreState): boolean {
    return (
        Object.keys(state.remoteFavoritesById || {}).length > 0 ||
        Object.keys(state.cachedFavoriteGroupsById || {}).length > 0 ||
        state.favoriteFriendIds.length > 0 ||
        state.favoriteWorldIds.length > 0 ||
        state.favoriteAvatarIds.length > 0 ||
        state.favoriteFriendGroups.length > 0 ||
        state.favoriteWorldGroups.length > 0 ||
        state.favoriteAvatarGroups.length > 0 ||
        Object.keys(state.localFriendFavorites || {}).length > 0 ||
        Object.keys(state.localAvatarFavorites || {}).length > 0 ||
        state.localFriendFavoriteGroups.length > 0 ||
        state.localAvatarFavoriteGroups.length > 0
    );
}
