import { normalizeUserId } from './userProfileFields';

export const DEFAULT_USER_STATS = Object.freeze({
    timeSpent: 0,
    lastSeen: '',
    friendedAt: '',
    joinCount: 0,
    previousDisplayNames: []
});

const userDialogCacheLimit = 128;
const cachedUserStatsByTarget = new Map();
const cachedPreviousInstancesByTarget = new Map();

export function dialogTargetKey(endpoint: any, userId: any) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return '';
    }
    return `${normalizeUserId(endpoint)}:${normalizedUserId}`;
}

function cloneUserStats(stats: any = DEFAULT_USER_STATS) {
    const previousDisplayNames = Array.isArray(stats?.previousDisplayNames)
        ? stats.previousDisplayNames.map((entry: any) => ({ ...entry }))
        : [];
    return {
        timeSpent: Number(stats?.timeSpent) || 0,
        lastSeen: stats?.lastSeen || '',
        friendedAt: stats?.friendedAt || '',
        joinCount: Number(stats?.joinCount) || 0,
        previousDisplayNames
    };
}

function setCappedCacheEntry(cache: any, key: any, value: any) {
    if (!key) {
        return;
    }
    if (cache.has(key)) {
        cache.delete(key);
    }
    cache.set(key, value);
    while (cache.size > userDialogCacheLimit) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
    }
}

function refreshCacheEntry(cache: any, key: any) {
    if (!key || !cache.has(key)) {
        return null;
    }
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
}

export function readCachedUserStats(key: any) {
    const value = refreshCacheEntry(cachedUserStatsByTarget, key);
    return value ? cloneUserStats(value) : cloneUserStats();
}

export function cacheUserStats(key: any, stats: any) {
    setCappedCacheEntry(cachedUserStatsByTarget, key, cloneUserStats(stats));
}

export function readCachedPreviousInstances(key: any) {
    const value = refreshCacheEntry(cachedPreviousInstancesByTarget, key);
    return value ? [...value] : [];
}

export function cachePreviousInstances(key: any, rows: any) {
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
