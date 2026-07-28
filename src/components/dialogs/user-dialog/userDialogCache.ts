import { normalizeUserId } from './userProfileFields';

export type UserDialogPreviousDisplayName = {
    displayName: string;
    updated_at?: string;
};

export type UserDialogPreviousDisplayNameSources = {
    friendLog: UserDialogPreviousDisplayName[];
    gameLog: UserDialogPreviousDisplayName[];
};

export type UserDialogStats = {
    timeSpent: number;
    lastSeen: string;
    friendedAt: string;
    joinCount: number;
    previousDisplayNames: UserDialogPreviousDisplayName[];
    previousDisplayNameSources?: UserDialogPreviousDisplayNameSources;
};

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

export const DEFAULT_USER_STATS = Object.freeze({
    timeSpent: 0,
    lastSeen: '',
    friendedAt: '',
    joinCount: 0,
    previousDisplayNames: []
});

const userDialogCacheLimit = 128;
const cachedUserStatsByTarget = new Map<string, UserDialogStats>();
const cachedPreviousInstancesByTarget = new Map<string, unknown[]>();

export function dialogTargetKey(endpoint: unknown, userId: unknown) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return '';
    }
    return `${normalizeUserId(endpoint)}:${normalizedUserId}`;
}

function clonePreviousDisplayNames(
    source: unknown
): UserDialogPreviousDisplayName[] {
    return Array.isArray(source)
        ? source.map((entry) => {
              const row = record(entry);
              return {
                  displayName: normalizeUserId(row.displayName),
                  ...(typeof row.updated_at === 'string'
                      ? { updated_at: row.updated_at }
                      : {})
              };
          })
        : [];
}

function cloneUserStats(source: unknown = DEFAULT_USER_STATS): UserDialogStats {
    const stats = record(source);
    const previousDisplayNames = clonePreviousDisplayNames(
        stats.previousDisplayNames
    );
    const rawPreviousDisplayNameSources = record(
        stats.previousDisplayNameSources
    );
    const previousDisplayNameSources =
        Object.keys(rawPreviousDisplayNameSources).length > 0
            ? {
                  friendLog: clonePreviousDisplayNames(
                      rawPreviousDisplayNameSources.friendLog
                  ),
                  gameLog: clonePreviousDisplayNames(
                      rawPreviousDisplayNameSources.gameLog
                  )
              }
            : undefined;

    return {
        timeSpent: Number(stats?.timeSpent) || 0,
        lastSeen: normalizeUserId(stats.lastSeen),
        friendedAt: normalizeUserId(stats.friendedAt),
        joinCount: Number(stats?.joinCount) || 0,
        previousDisplayNames,
        ...(previousDisplayNameSources ? { previousDisplayNameSources } : {})
    };
}

function setCappedCacheEntry<T>(cache: Map<string, T>, key: string, value: T) {
    if (!key) {
        return;
    }
    if (cache.has(key)) {
        cache.delete(key);
    }
    cache.set(key, value);
    while (cache.size > userDialogCacheLimit) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
            cache.delete(oldestKey);
        }
    }
}

function refreshCacheEntry<T>(cache: Map<string, T>, key: string) {
    if (!key || !cache.has(key)) {
        return null;
    }
    const value = cache.get(key);
    if (value === undefined) {
        return null;
    }
    cache.delete(key);
    cache.set(key, value);
    return value;
}

export function readCachedUserStats(key: string) {
    const value = refreshCacheEntry(cachedUserStatsByTarget, key);
    return value ? cloneUserStats(value) : cloneUserStats();
}

export function cacheUserStats(key: string, stats: unknown) {
    setCappedCacheEntry(cachedUserStatsByTarget, key, cloneUserStats(stats));
}

export function readCachedPreviousInstances(key: string) {
    const value = refreshCacheEntry(cachedPreviousInstancesByTarget, key);
    return value ? [...value] : [];
}

export function cachePreviousInstances(key: string, rows: unknown) {
    setCappedCacheEntry(
        cachedPreviousInstancesByTarget,
        key,
        Array.isArray(rows) ? [...rows] : []
    );
}

export function clearUserDialogCaches() {
    cachedUserStatsByTarget.clear();
    cachedPreviousInstancesByTarget.clear();
}
