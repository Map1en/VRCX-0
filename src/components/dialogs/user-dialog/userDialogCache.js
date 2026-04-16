import { normalizeUserId } from './userProfileFields.js';

export const DEFAULT_USER_STATS = Object.freeze({
    timeSpent: 0,
    lastSeen: '',
    joinCount: 0,
    previousDisplayNames: []
});

const userDialogCacheLimit = 128;
const cachedUserStatsByTarget = new Map();
const cachedPreviousInstancesByTarget = new Map();

export function dialogTargetKey(endpoint, userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return '';
    }
    return `${normalizeUserId(endpoint)}:${normalizedUserId}`;
}

function cloneUserStats(stats = DEFAULT_USER_STATS) {
    const previousDisplayNames = Array.isArray(stats?.previousDisplayNames)
        ? stats.previousDisplayNames.map((entry) => ({ ...entry }))
        : [];
    return {
        timeSpent: Number(stats?.timeSpent) || 0,
        lastSeen: stats?.lastSeen || '',
        joinCount: Number(stats?.joinCount) || 0,
        previousDisplayNames
    };
}

function setCappedCacheEntry(cache, key, value) {
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

function refreshCacheEntry(cache, key) {
    if (!key || !cache.has(key)) {
        return null;
    }
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
}

export function readCachedUserStats(key) {
    const value = refreshCacheEntry(cachedUserStatsByTarget, key);
    return value ? cloneUserStats(value) : cloneUserStats();
}

export function cacheUserStats(key, stats) {
    setCappedCacheEntry(cachedUserStatsByTarget, key, cloneUserStats(stats));
}

export function readCachedPreviousInstances(key) {
    const value = refreshCacheEntry(cachedPreviousInstancesByTarget, key);
    return value ? [...value] : [];
}

export function cachePreviousInstances(key, rows) {
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
