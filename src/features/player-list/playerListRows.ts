import { hasUserIdPrefix } from '@/shared/constants/vrchatIds';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';

import type {
    PlayerListContext,
    PlayerListProfileRecord,
    PlayerListRecord,
    PlayerListSourceRow
} from './playerListTypes';

function isRecord(value: unknown): value is PlayerListRecord {
    return Boolean(value && typeof value === 'object');
}

function toSourceRow(value: unknown): PlayerListSourceRow {
    return value as PlayerListSourceRow;
}

export function normalizePlayerUserId(value: unknown) {
    const normalized = normalizeString(value);
    return hasUserIdPrefix(normalized) ? normalized : '';
}

export function resolvePlayerRowUserId(row: unknown) {
    const record = isRecord(row) ? row : {};
    const ref = isRecord(record.ref) ? record.ref : {};
    return normalizePlayerUserId(
        record.userId ||
            record.user_id ||
            ref.id ||
            ref.userId ||
            ref.user_id ||
            record.id
    );
}

export function buildPlayerDialogSeedData(row: unknown) {
    if (!isRecord(row)) {
        return null;
    }

    const source = isRecord(row.userRef)
        ? row.userRef
        : isRecord(row.ref)
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

export function parseTimeMs(value: unknown) {
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

export function isLiveLocation(location: unknown) {
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
    remoteFavoriteIds: Iterable<unknown> | null | undefined,
    localFriendFavorites: Record<string, unknown> | null | undefined
) {
    const set = new Set<string>();

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
}: {
    playerRows?: unknown;
    runtimePlayerRows?: unknown;
    currentUserId?: unknown;
    currentUserSnapshot?: PlayerListProfileRecord | null;
    isGameRunning?: boolean;
    context: PlayerListContext;
    currentUserLocation?: unknown;
    currentLocationStartedAt?: unknown;
    runtimeRosterAvailable?: boolean;
}): PlayerListSourceRow[] {
    const rows: PlayerListSourceRow[] = [];
    const knownKeys = new Set<string>();

    const currentUserKey = normalizeString(currentUserId);
    const currentUserDisplayName = normalizeString(
        currentUserSnapshot?.displayName || currentUserSnapshot?.username
    ).toLowerCase();
    const activeLocation = currentUserLocation || context.location;
    const canUseLiveRows =
        isGameRunning &&
        activeLocation !== 'traveling' &&
        isLiveLocation(activeLocation);
    const addRow = (row: PlayerListSourceRow) => {
        const rowUserId = normalizeString(row.userId);
        const rowDisplayName = normalizeString(row.displayName).toLowerCase();
        if (
            (currentUserKey && rowUserId === currentUserKey) ||
            (currentUserDisplayName &&
                rowDisplayName === currentUserDisplayName)
        ) {
            return;
        }

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
            addRow(toSourceRow(row));
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
