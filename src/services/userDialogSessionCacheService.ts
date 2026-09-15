import type { InstanceHistoryEntryOutput } from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';

type UserDialogPreviousDisplayName = {
    displayName: string;
    updated_at?: string;
};

type UserDialogPreviousDisplayNameSources = {
    friendLog: UserDialogPreviousDisplayName[];
    gameLog: UserDialogPreviousDisplayName[];
};

export type UserDialogRelationshipEvent = {
    rowId: number;
    type: 'Friend' | 'Unfriend';
    created_at: string;
};

export function normalizeUserRelationshipHistory(
    source: unknown
): UserDialogRelationshipEvent[] {
    if (!Array.isArray(source)) {
        return [];
    }
    return source.flatMap((entry) => {
        const row = record(entry);
        if (
            (row.type !== 'Friend' && row.type !== 'Unfriend') ||
            typeof row.created_at !== 'string' ||
            typeof row.rowId !== 'number'
        ) {
            return [];
        }
        return [
            { rowId: row.rowId, type: row.type, created_at: row.created_at }
        ];
    });
}

export type UserDialogStats = {
    timeSpent: number;
    lastSeen: string;
    friendedAt: string;
    relationshipHistory: UserDialogRelationshipEvent[];
    joinCount: number;
    previousDisplayNames: UserDialogPreviousDisplayName[];
    previousDisplayNameSources?: UserDialogPreviousDisplayNameSources;
};

export type UserDialogPreviousInstance = InstanceHistoryEntryOutput;

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

export const DEFAULT_USER_STATS = Object.freeze({
    timeSpent: 0,
    lastSeen: '',
    friendedAt: '',
    relationshipHistory: [],
    joinCount: 0,
    previousDisplayNames: []
});

const userDialogCacheLimit = 128;
const cachedUserStatsByTarget = new Map<string, UserDialogStats>();
const cachedPreviousInstancesByTarget = new Map<
    string,
    UserDialogPreviousInstance[]
>();

export function dialogTargetKey(endpoint: string, userId: string) {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
        return '';
    }
    return `${normalizeString(endpoint)}:${normalizedUserId}`;
}

function clonePreviousDisplayNames(
    source: unknown
): UserDialogPreviousDisplayName[] {
    return Array.isArray(source)
        ? source.map((entry) => {
              const row = record(entry);
              return {
                  displayName: normalizeString(row.displayName),
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
        timeSpent: Number(stats.timeSpent) || 0,
        lastSeen: normalizeString(stats.lastSeen),
        friendedAt: normalizeString(stats.friendedAt),
        relationshipHistory: normalizeUserRelationshipHistory(
            stats.relationshipHistory
        ),
        joinCount: Number(stats.joinCount) || 0,
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

export function cachePreviousInstances(
    key: string,
    rows: readonly UserDialogPreviousInstance[]
) {
    setCappedCacheEntry(cachedPreviousInstancesByTarget, key, [...rows]);
}

export function clearUserDialogCaches() {
    cachedUserStatsByTarget.clear();
    cachedPreviousInstancesByTarget.clear();
}
