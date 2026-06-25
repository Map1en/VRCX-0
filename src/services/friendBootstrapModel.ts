import type {
    FriendLogCurrentEntry,
    FriendLogCurrentRow
} from '@/repositories/friendLogRepository';
import {
    computeTrustLevel,
    computeUserPlatform
} from '@/shared/utils/userTransforms';

export type FriendBootstrapSnapshot = Record<string, unknown> & {
    friendsById?: unknown;
    orderedFriendIds?: unknown;
    onlineIds?: unknown;
    activeIds?: unknown;
    offlineIds?: unknown;
    detail?: unknown;
};
export type FriendStateBucket = 'online' | 'active' | 'offline';
export type FriendRecord = Record<string, unknown> & {
    id?: unknown;
    userId?: unknown;
    user_id?: unknown;
    displayName?: unknown;
    username?: unknown;
    tags?: unknown;
    developerType?: unknown;
    platform?: unknown;
    last_platform?: unknown;
    location?: unknown;
    state?: unknown;
    stateBucket?: unknown;
    trustLevel?: unknown;
    $trustLevel?: unknown;
    friendNumber?: unknown;
    $friendNumber?: unknown;
    $profileSource?: unknown;
};
export type FriendLogRow = FriendLogCurrentRow & {
    user_id?: unknown;
    $friendNumber?: unknown;
    $trustLevel?: unknown;
};
export type FriendLogSeedRow = Partial<FriendLogRow>;
export type CurrentUserFriendSnapshot = Record<string, unknown> & {
    id?: unknown;
    friends?: unknown;
    offlineFriends?: unknown;
    activeFriends?: unknown;
    onlineFriends?: unknown;
};
export type RecordFriendLogFriendOptions = {
    currentUserId?: unknown;
    targetUserId?: unknown;
    targetUser?: unknown;
    stateBucket?: unknown;
    nowIso?: () => string;
};
export type RecordFriendLogFriendResult = {
    userId: string;
    targetUserId?: string;
    count: number;
    inserted?: boolean;
    historyCount: number;
};
export type RecordFriendLogUnfriendOptions = {
    currentUserId?: unknown;
    targetUserId?: unknown;
    nowIso?: () => string;
};
export type RecordFriendLogUnfriendResult = {
    userId: string;
    targetUserId: string;
    removedCount: number;
    historyCount: number;
};
export type FriendBootstrapOptions = {
    userId?: unknown;
    endpoint?: unknown;
    websocket?: unknown;
    currentUserSnapshot?: unknown;
    preserveLoadedState?: boolean;
};
export type FriendBootstrapResult = {
    userId: string;
    count: number;
    detail: string;
    stale: boolean;
};

export function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function normalizeStateBucket(value: unknown) {
    const normalized = normalizeUserId(value).toLowerCase();
    if (
        normalized === 'online' ||
        normalized === 'active' ||
        normalized === 'offline'
    ) {
        return normalized;
    }
    return '';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function asFriendRecord(value: unknown): FriendRecord | null {
    return isRecord(value) ? (value as FriendRecord) : null;
}

export function normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map((entry) => normalizeUserId(entry)).filter(Boolean)
        : [];
}

export function normalizeFriendsById(
    value: unknown
): Record<string, Record<string, unknown>> {
    if (!isRecord(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value).filter(([, friend]) => isRecord(friend))
    ) as Record<string, Record<string, unknown>>;
}

export function getDisplayName(
    user: Record<string, unknown> | null | undefined
) {
    return (
        normalizeUserId(user?.displayName) ||
        normalizeUserId(user?.username) ||
        normalizeUserId(user?.id)
    );
}

export function getMeaningfulDisplayName(
    user: FriendRecord | null | undefined,
    userId: unknown = ''
) {
    const normalizedUserId = normalizeUserId(userId || user?.id);
    for (const candidate of [user?.displayName, user?.username]) {
        const displayName = normalizeUserId(candidate);
        if (displayName && displayName !== normalizedUserId) {
            return displayName;
        }
    }
    return '';
}

function addStateBucketIds(
    stateById: Map<string, FriendStateBucket>,
    ids: unknown,
    state: FriendStateBucket
) {
    if (!Array.isArray(ids)) {
        return;
    }

    for (const value of ids) {
        const userId = normalizeUserId(value);
        if (!userId) {
            continue;
        }
        stateById.set(userId, state);
    }
}

export function buildFriendStateMap(
    currentUserSnapshot: CurrentUserFriendSnapshot
) {
    const stateById = new Map<string, FriendStateBucket>();
    addStateBucketIds(stateById, currentUserSnapshot?.friends, 'offline');
    addStateBucketIds(
        stateById,
        currentUserSnapshot?.offlineFriends,
        'offline'
    );
    addStateBucketIds(stateById, currentUserSnapshot?.activeFriends, 'active');
    addStateBucketIds(stateById, currentUserSnapshot?.onlineFriends, 'online');

    return stateById;
}

export function hasCompleteFriendStateSnapshot(
    currentUserSnapshot: unknown
): currentUserSnapshot is CurrentUserFriendSnapshot {
    if (!isRecord(currentUserSnapshot)) {
        return false;
    }
    return (
        Array.isArray(currentUserSnapshot.friends) &&
        Array.isArray(currentUserSnapshot.offlineFriends) &&
        Array.isArray(currentUserSnapshot.activeFriends) &&
        Array.isArray(currentUserSnapshot.onlineFriends)
    );
}

export function hasFriendListSnapshot(
    currentUserSnapshot: unknown
): currentUserSnapshot is CurrentUserFriendSnapshot & { friends: unknown[] } {
    return (
        isRecord(currentUserSnapshot) &&
        Array.isArray(currentUserSnapshot.friends)
    );
}

export function buildCurrentEntryFromFriend({
    userId,
    friend,
    friendNumber
}: {
    userId: string;
    friend: FriendRecord | null | undefined;
    friendNumber: number;
}): FriendLogCurrentEntry {
    const trustLevel =
        normalizeUserId(friend?.$trustLevel || friend?.trustLevel) || 'Visitor';
    return {
        userId,
        displayName: getDisplayName(friend) || userId,
        trustLevel,
        friendNumber
    };
}

export function createFallbackFriendUser(
    userId: unknown,
    existingRow: FriendLogRow
): FriendRecord {
    const normalizedUserId = normalizeUserId(userId);
    return {
        id: normalizedUserId,
        displayName: existingRow?.displayName || normalizedUserId,
        username: '',
        tags: [],
        developerType: '',
        platform: 'offline',
        last_platform: '',
        location: 'offline',
        state: 'offline'
    };
}

export function normalizeFriendEntry(
    friend: FriendRecord | null | undefined,
    stateBucket: string,
    existingRow: FriendLogRow
) {
    const source =
        friend ?? createFallbackFriendUser(existingRow?.userId, existingRow);
    const sourceRecord = source;
    const tags = Array.isArray(sourceRecord.tags)
        ? sourceRecord.tags.filter(
              (entry): entry is string => typeof entry === 'string'
          )
        : [];
    const trust = computeTrustLevel(
        tags,
        normalizeUserId(sourceRecord.developerType)
    );
    const explicitTrustLevel = normalizeUserId(
        sourceRecord.$trustLevel || sourceRecord.trustLevel
    );
    const hasTrustMetadata =
        Boolean(friend) &&
        (tags.length > 0 ||
            Boolean(sourceRecord.developerType) ||
            Boolean(explicitTrustLevel));
    const trustLevel =
        explicitTrustLevel ||
        (hasTrustMetadata
            ? trust.trustLevel
            : existingRow?.trustLevel || existingRow?.$trustLevel) ||
        trust.trustLevel;
    const friendNumber =
        Number.parseInt(
            String(
                sourceRecord?.friendNumber ??
                    sourceRecord?.$friendNumber ??
                    existingRow?.friendNumber ??
                    existingRow?.$friendNumber ??
                    0
            ),
            10
        ) || 0;
    const displayName =
        getMeaningfulDisplayName(
            sourceRecord,
            sourceRecord.id || existingRow?.userId
        ) ||
        existingRow?.displayName ||
        getDisplayName(sourceRecord) ||
        normalizeUserId(sourceRecord.id);

    return {
        ...sourceRecord,
        displayName,
        state: stateBucket,
        stateBucket,
        friendNumber,
        trustLevel,
        $friendNumber: friendNumber,
        $trustLevel: trustLevel,
        $trustClass: trust.trustClass,
        $trustSortNum: trust.trustSortNum,
        $isModerator: trust.isModerator,
        $isTroll: trust.isTroll,
        $isProbableTroll: trust.isProbableTroll,
        $platform: computeUserPlatform(
            normalizeUserId(sourceRecord.platform),
            normalizeUserId(sourceRecord.last_platform)
        )
    };
}

export function buildFriendLogRowsById(rows: FriendLogRow[] = []) {
    const rowsById = new Map<string, FriendLogRow>();
    if (!Array.isArray(rows)) {
        return rowsById;
    }

    for (const row of rows) {
        const userId = normalizeUserId(row?.userId || row?.user_id);
        if (!userId) {
            continue;
        }
        rowsById.set(userId, row);
    }
    return rowsById;
}

export function buildSeedRosterFriendsById(
    stateById: Map<string, FriendStateBucket>,
    friendLogRows: FriendLogRow[] = []
) {
    const rowsById = buildFriendLogRowsById(friendLogRows);
    const friendsById: Record<string, FriendRecord> = {};

    for (const [userId, stateBucket] of stateById.entries()) {
        const row: FriendLogSeedRow = rowsById.get(userId) ?? {};
        const trustLevel = normalizeUserId(row?.trustLevel) || 'Visitor';
        const friendNumber =
            Number.parseInt(
                String(row?.friendNumber ?? row?.$friendNumber ?? 0),
                10
            ) || 0;
        const displayName = normalizeUserId(row?.displayName) || userId;
        friendsById[userId] = {
            id: userId,
            displayName,
            username: '',
            tags: [],
            developerType: '',
            platform: 'offline',
            last_platform: '',
            location: 'offline',
            state: stateBucket,
            stateBucket,
            trustLevel,
            $trustLevel: trustLevel,
            friendNumber,
            $friendNumber: friendNumber
        };
    }

    return friendsById;
}
