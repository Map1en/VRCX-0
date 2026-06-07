import { create } from 'zustand';

import {
    computeTrustLevel,
    computeUserPlatform
} from '@/shared/utils/userTransforms';

type FriendRosterBucket = 'online' | 'active' | 'offline';
type FriendRecord = Record<string, unknown> & {
    id?: unknown;
    userId?: unknown;
    displayName?: unknown;
    username?: unknown;
    tags?: unknown;
    developerType?: unknown;
    platform?: unknown;
    last_platform?: unknown;
    lastPlatform?: unknown;
    location?: unknown;
    state?: unknown;
    stateBucket?: unknown;
    trustLevel?: unknown;
    $trustLevel?: unknown;
    friendNumber?: unknown;
    $friendNumber?: unknown;
};
type FriendRosterOrdering = {
    onlineIds: string[];
    activeIds: string[];
    offlineIds: string[];
    orderedFriendIds: string[];
};
type FriendRosterSnapshot = FriendRosterOrdering & {
    currentUserId: string | null;
    friendsById: Record<string, FriendRecord>;
    detail?: string;
};
type FriendRosterSeedSnapshot = {
    currentUserId: string | null;
    friendsById: Record<string, FriendRecord>;
    detail?: string;
};
type FriendPatchEntry = {
    userId?: unknown;
    patch?: FriendRecord;
    stateBucket?: unknown;
    stateBucketAuthority?: unknown;
};
type FriendRosterStore = FriendRosterSnapshot & {
    loadStatus: 'idle' | 'running' | 'ready' | 'error';
    detail: string;
    lastLoadedAt: string | null;
    setRosterLoading(currentUserId: unknown, detail?: string): void;
    setRosterSeedSnapshot(snapshot: FriendRosterSeedSnapshot): void;
    setRosterSnapshot(snapshot: FriendRosterSnapshot): void;
    setRosterError(detail: string): void;
    applyFriendPatch(entry: FriendPatchEntry & { detail?: string }): void;
    applyFriendPatches(patches?: FriendPatchEntry[], detail?: string): void;
    removeFriend(userId: unknown, detail?: string): void;
    resetRoster(): void;
};

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeStateBucket(value: unknown): FriendRosterBucket | '' {
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

function resolveFriendStateBucket({
    patch,
    stateBucket,
    stateBucketAuthority,
    existingEntry
}: {
    patch?: FriendRecord | null;
    stateBucket?: unknown;
    stateBucketAuthority?: unknown;
    existingEntry?: FriendRecord | null;
}): FriendRosterBucket {
    if (normalizeUserId(stateBucketAuthority).toLowerCase() === 'preserve') {
        return (
            normalizeStateBucket(existingEntry?.stateBucket) ||
            normalizeStateBucket(existingEntry?.state) ||
            'offline'
        );
    }

    const explicitStateBucket =
        normalizeStateBucket(stateBucket) ||
        normalizeStateBucket(patch?.stateBucket) ||
        normalizeStateBucket(patch?.state);

    return (
        explicitStateBucket ||
        normalizeStateBucket(existingEntry?.stateBucket) ||
        normalizeStateBucket(existingEntry?.state) ||
        'offline'
    );
}

function getDisplayName(user: FriendRecord | null | undefined): unknown {
    return user?.displayName || user?.username || user?.id || '';
}

function createFallbackFriendUser(
    userId: string,
    existingRow?: FriendRecord | null
): FriendRecord {
    return {
        id: userId,
        displayName: existingRow?.displayName || userId,
        username: '',
        tags: [],
        developerType: '',
        platform: 'offline',
        last_platform: '',
        location: 'offline',
        state: 'offline'
    };
}

function normalizePlatformAliases(friend: FriendRecord): FriendRecord {
    const normalizedFriend = { ...friend };
    const lastPlatform = normalizeUserId(normalizedFriend.lastPlatform);
    if (lastPlatform) {
        normalizedFriend.last_platform = lastPlatform;
    }
    delete normalizedFriend.lastPlatform;
    return normalizedFriend;
}

function normalizeFriendEntry(
    friend: FriendRecord | null | undefined,
    stateBucket: FriendRosterBucket,
    existingRow?: FriendRecord | null
): FriendRecord {
    const fallbackUserId = normalizeUserId(
        existingRow?.id || existingRow?.userId
    );
    const source = normalizePlatformAliases(
        friend ?? createFallbackFriendUser(fallbackUserId, existingRow)
    );
    const tags = Array.isArray(source.tags) ? source.tags : [];
    const trust = computeTrustLevel(tags, String(source.developerType || ''));
    const explicitTrustLevel = String(
        source.$trustLevel || source.trustLevel || ''
    );
    const hasTrustMetadata =
        Boolean(friend) &&
        (tags.length > 0 ||
            Boolean(source.developerType) ||
            Boolean(explicitTrustLevel));
    const trustLevel =
        explicitTrustLevel ||
        (hasTrustMetadata
            ? trust.trustLevel
            : String(
                  existingRow?.trustLevel || existingRow?.$trustLevel || ''
              )) ||
        trust.trustLevel;
    const friendNumber =
        Number.parseInt(
            (source?.friendNumber ??
                source?.$friendNumber ??
                existingRow?.friendNumber ??
                existingRow?.$friendNumber ??
                0) as string,
            10
        ) || 0;
    const displayName =
        getDisplayName(source) || existingRow?.displayName || source.id;

    return {
        ...source,
        id: normalizeUserId(source.id),
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
            source.platform as string,
            source.last_platform as string
        )
    };
}

function compareFriendEntries(
    left: FriendRecord | null | undefined,
    right: FriendRecord | null | undefined
): number {
    const leftNumber =
        Number.parseInt(
            (left?.friendNumber ?? left?.$friendNumber ?? 0) as string,
            10
        ) || 0;
    const rightNumber =
        Number.parseInt(
            (right?.friendNumber ?? right?.$friendNumber ?? 0) as string,
            10
        ) || 0;
    const leftHasNumber = leftNumber > 0;
    const rightHasNumber = rightNumber > 0;

    if (leftHasNumber !== rightHasNumber) {
        return leftHasNumber ? -1 : 1;
    }

    if (leftHasNumber && rightHasNumber && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
    }

    const leftName = String(left?.displayName || left?.id || '').toLowerCase();
    const rightName = String(
        right?.displayName || right?.id || ''
    ).toLowerCase();
    const nameComparison = leftName.localeCompare(rightName);
    if (nameComparison !== 0) {
        return nameComparison;
    }

    return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function buildBucketIds(
    friendIds: string[],
    friendsById: Record<string, FriendRecord>,
    stateBucket: FriendRosterBucket
): string[] {
    return friendIds
        .filter(
            (friendId: any) =>
                friendsById[friendId]?.stateBucket === stateBucket
        )
        .sort((leftId: any, rightId: any) =>
            compareFriendEntries(friendsById[leftId], friendsById[rightId])
        );
}

function buildRosterOrdering(
    friendsById: Record<string, FriendRecord>
): FriendRosterOrdering {
    const friendIds = Object.keys(friendsById);
    const onlineIds = buildBucketIds(friendIds, friendsById, 'online');
    const activeIds = buildBucketIds(friendIds, friendsById, 'active');
    const offlineIds = buildBucketIds(friendIds, friendsById, 'offline');

    return {
        onlineIds,
        activeIds,
        offlineIds,
        orderedFriendIds: [...onlineIds, ...activeIds, ...offlineIds]
    };
}

function normalizeRosterSnapshotFriends(
    friendsById: Record<string, FriendRecord> | null | undefined
): Record<string, FriendRecord> {
    const normalizedFriendsById: Record<string, FriendRecord> = {};
    for (const [rawUserId, friend] of Object.entries(friendsById || {})) {
        const normalizedUserId =
            normalizeUserId(friend?.id || friend?.userId) ||
            normalizeUserId(rawUserId);
        if (!normalizedUserId) {
            continue;
        }
        const stateBucket = resolveFriendStateBucket({
            patch: friend,
            existingEntry: friend
        });
        normalizedFriendsById[normalizedUserId] = normalizeFriendEntry(
            {
                ...friend,
                id: normalizedUserId
            },
            stateBucket,
            friend
        );
    }
    return normalizedFriendsById;
}

function friendEntryNeedsOrderingUpdate(
    existingEntry: FriendRecord | null | undefined,
    nextEntry: FriendRecord
): boolean {
    if (!existingEntry) {
        return true;
    }
    const existingBucket =
        normalizeStateBucket(existingEntry?.stateBucket) ||
        normalizeStateBucket(existingEntry?.state) ||
        'offline';
    const nextBucket =
        normalizeStateBucket(nextEntry?.stateBucket) ||
        normalizeStateBucket(nextEntry?.state) ||
        'offline';

    if (existingBucket !== nextBucket) {
        return true;
    }

    return compareFriendEntries(existingEntry, nextEntry) !== 0;
}

const initialState: Pick<
    FriendRosterStore,
    | 'currentUserId'
    | 'loadStatus'
    | 'detail'
    | 'lastLoadedAt'
    | 'friendsById'
    | 'orderedFriendIds'
    | 'onlineIds'
    | 'activeIds'
    | 'offlineIds'
> = {
    currentUserId: null,
    loadStatus: 'idle',
    detail: '',
    lastLoadedAt: null,
    friendsById: {} as Record<string, FriendRecord>,
    orderedFriendIds: [] as string[],
    onlineIds: [] as string[],
    activeIds: [] as string[],
    offlineIds: [] as string[]
};

export const useFriendRosterStore = create<FriendRosterStore>((set: any) => ({
    ...initialState,
    setRosterLoading(currentUserId: any, detail: any = '') {
        set((state: any) => {
            const normalizedCurrentUserId =
                normalizeUserId(currentUserId) || null;
            const isSameUser =
                normalizeUserId(state.currentUserId) ===
                normalizedCurrentUserId;
            const hasRoster =
                Object.keys(state.friendsById || {}).length > 0 ||
                state.orderedFriendIds.length > 0;

            if (isSameUser && hasRoster) {
                return {
                    ...state,
                    currentUserId: normalizedCurrentUserId,
                    loadStatus: 'running',
                    detail
                };
            }

            return {
                currentUserId: normalizedCurrentUserId,
                loadStatus: 'running',
                detail,
                lastLoadedAt: null,
                friendsById: {},
                orderedFriendIds: [],
                onlineIds: [],
                activeIds: [],
                offlineIds: []
            };
        });
    },
    setRosterSnapshot({
        currentUserId,
        friendsById,
        detail = ''
    }: any) {
        const normalizedFriendsById =
            normalizeRosterSnapshotFriends(friendsById);
        const ordering = buildRosterOrdering(normalizedFriendsById);
        set({
            currentUserId,
            loadStatus: 'ready',
            detail,
            lastLoadedAt: new Date().toISOString(),
            friendsById: normalizedFriendsById,
            orderedFriendIds: ordering.orderedFriendIds,
            onlineIds: ordering.onlineIds,
            activeIds: ordering.activeIds,
            offlineIds: ordering.offlineIds
        });
    },
    setRosterSeedSnapshot({
        currentUserId,
        friendsById,
        detail = ''
    }: any) {
        const normalizedFriendsById =
            normalizeRosterSnapshotFriends(friendsById);
        const ordering = buildRosterOrdering(normalizedFriendsById);
        set({
            currentUserId: normalizeUserId(currentUserId) || null,
            loadStatus: 'running',
            detail,
            lastLoadedAt: new Date().toISOString(),
            friendsById: normalizedFriendsById,
            orderedFriendIds: ordering.orderedFriendIds,
            onlineIds: ordering.onlineIds,
            activeIds: ordering.activeIds,
            offlineIds: ordering.offlineIds
        });
    },
    setRosterError(detail: any) {
        set((state: any) => ({
            ...state,
            loadStatus: 'error',
            detail,
            lastLoadedAt: new Date().toISOString()
        }));
    },
    applyFriendPatch({
        userId,
        patch = {},
        stateBucket,
        stateBucketAuthority,
        detail = ''
    }: any) {
        set((state: any) => {
            const normalizedUserId = normalizeUserId(userId || patch?.id);
            if (!normalizedUserId) {
                return state;
            }

            const existingEntry = state.friendsById[normalizedUserId] ?? null;
            const nextStateBucket = resolveFriendStateBucket({
                patch,
                stateBucket,
                stateBucketAuthority,
                existingEntry
            });
            const mergedUser: any = {
                ...(existingEntry ??
                    createFallbackFriendUser(normalizedUserId, existingEntry)),
                ...(patch && typeof patch === 'object' ? patch : {}),
                id: normalizedUserId
            };
            const normalizedEntry = normalizeFriendEntry(
                mergedUser,
                nextStateBucket,
                existingEntry ?? {
                    id: normalizedUserId,
                    userId: normalizedUserId,
                    displayName: normalizedUserId,
                    friendNumber: 0
                }
            );
            const friendsById: any = {
                ...state.friendsById,
                [normalizedUserId]: normalizedEntry
            };
            const orderingDirty = friendEntryNeedsOrderingUpdate(
                existingEntry,
                normalizedEntry
            );
            return {
                ...state,
                ...(orderingDirty ? buildRosterOrdering(friendsById) : {}),
                friendsById,
                loadStatus:
                    state.loadStatus === 'idle' ? 'ready' : state.loadStatus,
                detail: detail || state.detail,
                lastLoadedAt: new Date().toISOString()
            };
        });
    },
    applyFriendPatches(patches: any[] = [], detail: any = '') {
        set((state: any) => {
            if (!Array.isArray(patches) || patches.length === 0) {
                return state;
            }

            let changed = false;
            let orderingDirty = false;
            const friendsById: any = { ...state.friendsById };

            for (const entry of patches) {
                const patch =
                    entry?.patch && typeof entry.patch === 'object'
                        ? entry.patch
                        : {};
                const normalizedUserId = normalizeUserId(
                    entry?.userId || patch?.id
                );
                if (!normalizedUserId) {
                    continue;
                }

                const existingEntry = friendsById[normalizedUserId] ?? null;
                const nextStateBucket = resolveFriendStateBucket({
                    patch,
                    stateBucket: entry?.stateBucket,
                    stateBucketAuthority: entry?.stateBucketAuthority,
                    existingEntry
                });
                const mergedUser: any = {
                    ...(existingEntry ??
                        createFallbackFriendUser(
                            normalizedUserId,
                            existingEntry
                        )),
                    ...patch,
                    id: normalizedUserId
                };
                const normalizedEntry = normalizeFriendEntry(
                    mergedUser,
                    nextStateBucket,
                    existingEntry ?? {
                        id: normalizedUserId,
                        userId: normalizedUserId,
                        displayName: normalizedUserId,
                        friendNumber: 0
                    }
                );
                if (
                    friendEntryNeedsOrderingUpdate(
                        existingEntry,
                        normalizedEntry
                    )
                ) {
                    orderingDirty = true;
                }
                friendsById[normalizedUserId] = normalizedEntry;
                changed = true;
            }

            if (!changed) {
                return state;
            }

            return {
                ...state,
                ...(orderingDirty ? buildRosterOrdering(friendsById) : {}),
                friendsById,
                loadStatus:
                    state.loadStatus === 'idle' ? 'ready' : state.loadStatus,
                detail: detail || state.detail,
                lastLoadedAt: new Date().toISOString()
            };
        });
    },
    removeFriend(userId: any, detail: any = '') {
        set((state: any) => {
            const normalizedUserId = normalizeUserId(userId);
            if (!normalizedUserId || !state.friendsById[normalizedUserId]) {
                return state;
            }

            const friendsById: any = { ...state.friendsById };
            delete friendsById[normalizedUserId];

            return {
                ...state,
                ...buildRosterOrdering(friendsById),
                friendsById,
                detail: detail || state.detail,
                lastLoadedAt: new Date().toISOString()
            };
        });
    },
    resetRoster() {
        set(initialState);
    }
}));
