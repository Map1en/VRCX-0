import type { FriendLogCurrentRow } from '@/repositories/friendLogRepository';

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

export function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
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

export function buildFriendLogRowsById(rows: FriendLogSeedRow[] = []) {
    const rowsById = new Map<string, FriendLogSeedRow>();
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
    friendLogRows: FriendLogSeedRow[] = []
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
