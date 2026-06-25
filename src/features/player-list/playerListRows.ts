import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';

export function normalizePlayerUserId(value: any) {
    const normalized = normalizeString(value);
    return normalized.startsWith('usr_') ? normalized : '';
}

export function resolvePlayerRowUserId(row: any) {
    return normalizePlayerUserId(
        row?.userId ||
            row?.user_id ||
            row?.ref?.id ||
            row?.ref?.userId ||
            row?.ref?.user_id ||
            row?.id
    );
}

export function buildPlayerDialogSeedData(row: any) {
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

export function parseTimeMs(value: any) {
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

export function isLiveLocation(location: any) {
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

export function buildFavoriteIdSet(
    remoteFavoriteIds: any,
    localFriendFavorites: any
) {
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
    currentLocationStartedAt,
    runtimeRosterAvailable = false
}: any) {
    const rows = [];
    const knownKeys = new Set();

    const currentUserKey = normalizeString(currentUserId);
    const activeLocation = currentUserLocation || context.location;
    const canUseLiveRows =
        isGameRunning &&
        activeLocation !== 'traveling' &&
        isLiveLocation(activeLocation);
    const addRow = (row: any) => {
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
        const sourceRows =
            runtimeRosterAvailable && !context?.playerFactsKnown
                ? runtimePlayerRows
                : playerRows;
        for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
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
