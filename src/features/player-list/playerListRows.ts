import { hasUserIdPrefix } from '@/shared/constants/vrchatIds';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';

import type {
    PlayerListContext,
    PlayerListCurrentUserSnapshot,
    PlayerListRosterRow,
    PlayerListSourceRow
} from './playerListTypes';

function normalizePlayerUserId(value: unknown) {
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

export function buildPlayerSourceRows({
    playerRows,
    currentUserId,
    currentUserSnapshot,
    isGameRunning,
    context,
    currentUserLocation,
    currentLocationStartedAt
}: {
    playerRows?: readonly PlayerListRosterRow[];
    currentUserId?: string | null;
    currentUserSnapshot?: PlayerListCurrentUserSnapshot | null;
    isGameRunning?: boolean;
    context: PlayerListContext;
    currentUserLocation?: string | null;
    currentLocationStartedAt?: string | null;
}): PlayerListSourceRow[] {
    const rows: PlayerListSourceRow[] = [];
    const knownKeys = new Set<string>();
    let observedCurrentUser = false;

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
            currentUserSnapshot &&
            currentUserKey &&
            context.playerFactsKnown === true &&
            currentUserDisplayName &&
            ((currentUserKey && rowUserId === currentUserKey) ||
                (!rowUserId && rowDisplayName === currentUserDisplayName))
        ) {
            observedCurrentUser = true;
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
        const sourceRows = playerRows;
        for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
            addRow(row);
        }
    }

    if (
        observedCurrentUser &&
        currentUserKey &&
        currentUserSnapshot &&
        context.playerFactsKnown === true &&
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
