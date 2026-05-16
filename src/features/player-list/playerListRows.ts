// @ts-nocheck
import { parseLocation } from '@/shared/utils/locationParser.js';

export function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function normalizePlayerUserId(value) {
    const normalized = normalizeString(value);
    return normalized.startsWith('usr_') ? normalized : '';
}

export function resolvePlayerRowUserId(row) {
    return normalizePlayerUserId(
        row?.userId ||
            row?.user_id ||
            row?.ref?.id ||
            row?.ref?.userId ||
            row?.ref?.user_id ||
            row?.id
    );
}

function normalizeDisplayNameKey(value) {
    return normalizeString(value).toLowerCase();
}

function normalizeApiUserId(value) {
    return normalizePlayerUserId(value?.id || value?.userId || value?.user_id);
}

function normalizeApiDisplayName(value) {
    return normalizeString(
        value?.displayName ||
            value?.display_name ||
            value?.username ||
            value?.name
    );
}

export function shouldFetchInstanceUsers(playerRows) {
    const rows = Array.isArray(playerRows) ? playerRows : [];
    return !rows.length || rows.some((row) => !resolvePlayerRowUserId(row));
}

export function mergePlayerRowsWithApiUsers(playerRows, apiUsers) {
    const sourceRows = Array.isArray(playerRows) ? playerRows : [];
    const users = Array.isArray(apiUsers) ? apiUsers : [];
    const usersById = new Map();
    const usersByName = new Map();

    for (const user of users) {
        if (!user || typeof user !== 'object') {
            continue;
        }

        const userId = normalizeApiUserId(user);
        const displayName = normalizeApiDisplayName(user);
        if (userId && !usersById.has(userId)) {
            usersById.set(userId, user);
        }
        const nameKey = normalizeDisplayNameKey(displayName);
        if (nameKey && !usersByName.has(nameKey)) {
            usersByName.set(nameKey, user);
        }
    }

    const matchedUserIds = new Set();
    const matchedNames = new Set();
    const mergedRows = sourceRows.map((row) => {
        const rowUserId = resolvePlayerRowUserId(row);
        const rowNameKey = normalizeDisplayNameKey(
            row?.displayName || row?.ref?.displayName
        );
        const apiUser =
            (rowUserId && usersById.get(rowUserId)) ||
            (rowNameKey && usersByName.get(rowNameKey));

        if (!apiUser) {
            return row;
        }

        const apiUserId = normalizeApiUserId(apiUser);
        const apiDisplayName = normalizeApiDisplayName(apiUser);
        const existingRef =
            row?.ref && typeof row.ref === 'object' ? row.ref : null;
        const ref = existingRef ? { ...apiUser, ...existingRef } : apiUser;
        if (apiUserId) {
            matchedUserIds.add(apiUserId);
        }
        const matchedNameKey = normalizeDisplayNameKey(apiDisplayName);
        if (matchedNameKey) {
            matchedNames.add(matchedNameKey);
        }

        return {
            ...apiUser,
            ...row,
            id: apiUserId || row?.id,
            userId: apiUserId || row?.userId || '',
            displayName:
                normalizeString(row?.displayName) ||
                apiDisplayName ||
                apiUserId ||
                '',
            ref
        };
    });

    for (const apiUser of users) {
        const apiUserId = normalizeApiUserId(apiUser);
        const apiDisplayName = normalizeApiDisplayName(apiUser);
        const nameKey = normalizeDisplayNameKey(apiDisplayName);
        if (
            (apiUserId && matchedUserIds.has(apiUserId)) ||
            (nameKey && matchedNames.has(nameKey))
        ) {
            continue;
        }
        mergedRows.push({
            ...apiUser,
            id: apiUserId || apiUser?.id,
            userId: apiUserId,
            displayName: apiDisplayName || apiUserId || '',
            ref:
                apiUser?.ref && typeof apiUser.ref === 'object'
                    ? apiUser.ref
                    : apiUser
        });
    }

    return mergedRows;
}

export function buildPlayerDialogSeedData(row) {
    if (!row || typeof row !== 'object') {
        return null;
    }

    const source =
        row.userRef && typeof row.userRef === 'object'
            ? row.userRef
            : row.ref && typeof row.ref === 'object'
              ? row.ref
              : row;
    const userId =
        resolvePlayerRowUserId(row) || normalizePlayerUserId(source?.id);
    const displayName = normalizeString(
        source?.displayName ||
            source?.username ||
            row?.displayName ||
            row?.username
    );

    return {
        ...source,
        ...(userId ? { id: userId, userId } : null),
        ...(displayName ? { displayName } : null)
    };
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
    runtimePlayerRows,
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
    const activeLocation = currentUserLocation || context.location;
    const canUseLiveRows =
        isGameRunning &&
        activeLocation !== 'traveling' &&
        isLiveLocation(activeLocation);
    const addRow = (row) => {
        const rowUserId = normalizeString(row.userId);
        if (currentUserKey && rowUserId === currentUserKey) {
            return;
        }

        const rowDisplayName = normalizeString(row.displayName).toLowerCase();
        const rowKey =
            rowUserId ||
            normalizeString(row.id || row.rowId) ||
            (rowDisplayName ? `display:${rowDisplayName}` : '');
        if (rowKey && knownKeys.has(rowKey)) {
            return;
        }
        rows.push(row);
        if (rowKey) {
            knownKeys.add(rowKey);
        }
    };

    if (canUseLiveRows) {
        for (const row of Array.isArray(playerRows) ? playerRows : []) {
            addRow(row);
        }

        for (const row of Array.isArray(runtimePlayerRows)
            ? runtimePlayerRows
            : []) {
            addRow(row);
        }
    }

    if (
        currentUserKey &&
        currentUserSnapshot &&
        canUseLiveRows &&
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
