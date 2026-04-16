import { parseLocation } from '@/shared/utils/locationParser.js';

export function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function parseTimeMs(value) {
    if (!value) {
        return 0;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    const text = normalizeString(value);
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

export function isLiveLocation(location) {
    const normalized = normalizeString(location);
    if (!normalized) {
        return false;
    }
    const parsed = parseLocation(normalized);
    return Boolean(
        parsed.worldId &&
        !parsed.isOffline &&
        !parsed.isPrivate &&
        !parsed.isTraveling
    );
}

export function buildFavoriteIdSet(remoteFavoriteIds, localFriendFavorites) {
    const set = new Set();

    for (const id of remoteFavoriteIds ?? []) {
        const normalized = normalizeString(id);
        if (normalized) {
            set.add(normalized);
        }
    }

    for (const values of Object.values(localFriendFavorites ?? {})) {
        if (!Array.isArray(values)) {
            continue;
        }
        for (const id of values) {
            const normalized = normalizeString(id);
            if (normalized) {
                set.add(normalized);
            }
        }
    }

    return set;
}

export function buildPlayerSourceRows({
    playerRows,
    currentUserId,
    currentUserSnapshot,
    isGameRunning,
    context,
    currentUserLocation,
    currentLocationStartedAt
}) {
    const rows = [];
    const knownKeys = new Set();

    const currentUserKey = normalizeString(currentUserId);
    for (const row of Array.isArray(playerRows) ? playerRows : []) {
        const rowUserId = normalizeString(row.userId);
        if (currentUserKey && rowUserId === currentUserKey) {
            continue;
        }

        const rowKey = rowUserId || normalizeString(row.id || row.rowId);
        if (rowKey && knownKeys.has(rowKey)) {
            continue;
        }
        rows.push(row);
        if (rowKey) {
            knownKeys.add(rowKey);
        }
    }

    if (
        currentUserKey &&
        currentUserSnapshot &&
        isGameRunning &&
        isLiveLocation(context.location || currentUserLocation) &&
        !knownKeys.has(currentUserKey)
    ) {
        const joinedAtMs = parseTimeMs(
            currentLocationStartedAt || context.createdAt
        );
        rows.unshift({
            id: currentUserKey,
            userId: currentUserKey,
            displayName:
                currentUserSnapshot.displayName ||
                currentUserSnapshot.username ||
                currentUserKey,
            joinedAt: joinedAtMs ? new Date(joinedAtMs).toISOString() : '',
            joinedAtMs,
            lastDurationMs: 0,
            ref: currentUserSnapshot,
            source: 'runtime'
        });
        knownKeys.add(currentUserKey);
    }

    return rows;
}
