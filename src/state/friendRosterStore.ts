import { replaceEqualDeep } from '@tanstack/react-query';
import { create } from 'zustand';

import { presencePlatform, presenceSection } from '@/domain/friends/presence';
import {
    FRIEND_PROFILE_BOOLEAN_FIELDS,
    FRIEND_PROFILE_STRING_FIELDS,
    type FriendPatchEntry,
    type FriendProfileFields,
    type FriendRecord,
    type FriendRecordInput,
    type FriendRosterBucket,
    type FriendRosterById,
    type FriendRosterInputById,
    type FriendRosterOrdering,
    type FriendRosterSnapshotInput,
    type FriendRosterState,
    type FriendRosterStore
} from '@/domain/friends/types';
import { isRecord } from '@/shared/utils/record';
import { computeTrustLevel } from '@/shared/utils/userTransforms';

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeOptionalString(value: unknown): string | null | undefined {
    if (typeof value === 'string') {
        return value;
    }
    return value === null ? null : undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function normalizeOptionalStringArray(
    value: unknown,
    previous?: string[]
): string[] | undefined {
    if (value === previous) {
        return previous;
    }
    return Array.isArray(value) ? value.map(String) : undefined;
}

function normalizeOptionalArray(
    value: unknown,
    previous?: unknown[]
): unknown[] | undefined {
    if (value === previous) {
        return previous;
    }
    return Array.isArray(value) ? [...value] : undefined;
}

function normalizeFriendProfileFields(
    source: FriendRecordInput,
    previous?: FriendRecord | null
): FriendProfileFields {
    const profile: FriendProfileFields = {};

    for (const field of FRIEND_PROFILE_STRING_FIELDS) {
        const value = normalizeOptionalString(source[field]);
        if (value !== undefined) {
            profile[field] = value;
        }
    }
    for (const field of FRIEND_PROFILE_BOOLEAN_FIELDS) {
        const value = normalizeOptionalBoolean(source[field]);
        if (value !== undefined) {
            profile[field] = value;
        }
    }

    const badges = normalizeOptionalArray(source.badges, previous?.badges);
    if (badges !== undefined) {
        profile.badges = badges;
    }

    return profile;
}

function normalizeFriendRecordMap(
    value: FriendRosterInputById | null | undefined
): FriendRosterInputById {
    const friendsById: FriendRosterInputById = {};
    if (!isRecord(value)) {
        return friendsById;
    }
    for (const [userId, friend] of Object.entries(value)) {
        if (isRecord(friend)) {
            friendsById[userId] = { ...friend };
        }
    }
    return friendsById;
}

function getDisplayName(user: FriendRecordInput | null | undefined): string {
    return (
        normalizeUserId(user?.displayName) ||
        normalizeUserId(user?.username) ||
        normalizeUserId(user?.id)
    );
}

function createFallbackFriendUser(
    userId: string,
    existingRow?: FriendRecord | null
): FriendRecordInput {
    return {
        id: userId,
        displayName: existingRow?.displayName || userId,
        username: '',
        tags: [],
        developerType: '',
        last_platform: ''
    };
}

function normalizePlatformAliases(
    friend: FriendRecordInput
): FriendRecordInput {
    if (!Object.hasOwn(friend, 'lastPlatform')) {
        return friend;
    }
    const normalizedFriend = { ...friend };
    const lastPlatform = normalizeUserId(normalizedFriend.lastPlatform);
    if (lastPlatform) {
        normalizedFriend.last_platform = lastPlatform;
    }
    delete normalizedFriend.lastPlatform;
    return normalizedFriend;
}

function normalizeFriendEntry(
    friend: FriendRecordInput | null | undefined,
    existingRow?: FriendRecord | null
): FriendRecord {
    const fallbackUserId = normalizeUserId(
        existingRow?.id || existingRow?.userId
    );
    const source = normalizePlatformAliases(
        friend ?? createFallbackFriendUser(fallbackUserId, existingRow)
    );
    const tags =
        normalizeOptionalStringArray(source.tags, existingRow?.tags) ?? [];
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
    const friendNumberSource =
        source?.$friendNumber ??
        source?.friendNumber ??
        existingRow?.$friendNumber ??
        existingRow?.friendNumber ??
        0;
    const friendNumber = Number.parseInt(String(friendNumberSource), 10) || 0;
    const presence = source.$presence ?? { kind: 'offline' };
    const displayName =
        getDisplayName(source) ||
        normalizeUserId(existingRow?.displayName) ||
        normalizeUserId(source.id);

    return replaceEqualDeep(existingRow, {
        ...source,
        ...normalizeFriendProfileFields(source, existingRow),
        id: normalizeUserId(source.id),
        displayName,
        tags,
        $presence: presence,
        friendNumber,
        trustLevel,
        $friendNumber: friendNumber,
        $trustLevel: trustLevel,
        $trustClass: trust.trustClass,
        $trustSortNum: trust.trustSortNum,
        $isModerator: trust.isModerator,
        $isTroll: trust.isTroll,
        $isProbableTroll: trust.isProbableTroll,
        $platform: presencePlatform(
            presence,
            typeof source.last_platform === 'string' ? source.last_platform : ''
        )
    });
}

function compareFriendEntries(
    left: FriendRecord | null | undefined,
    right: FriendRecord | null | undefined
): number {
    const leftNumber =
        Number.parseInt(
            String(left?.friendNumber ?? left?.$friendNumber ?? 0),
            10
        ) || 0;
    const rightNumber =
        Number.parseInt(
            String(right?.friendNumber ?? right?.$friendNumber ?? 0),
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
    friendsById: FriendRosterById,
    stateBucket: FriendRosterBucket
): string[] {
    return friendIds
        .filter(
            (friendId) =>
                presenceSection(friendsById[friendId].$presence) === stateBucket
        )
        .sort((leftId, rightId) =>
            compareFriendEntries(friendsById[leftId], friendsById[rightId])
        );
}

function buildRosterOrdering(
    friendsById: FriendRosterById
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
    friendsById: FriendRosterInputById | null | undefined
): FriendRosterById {
    const normalizedFriendsById: FriendRosterById = {};
    for (const [rawUserId, friend] of Object.entries(
        normalizeFriendRecordMap(friendsById)
    )) {
        const normalizedUserId =
            normalizeUserId(friend?.id || friend?.userId) ||
            normalizeUserId(rawUserId);
        if (!normalizedUserId) {
            continue;
        }
        normalizedFriendsById[normalizedUserId] = normalizeFriendEntry({
            ...friend,
            id: normalizedUserId
        });
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
    if (
        presenceSection(existingEntry.$presence) !==
        presenceSection(nextEntry.$presence)
    ) {
        return true;
    }

    return compareFriendEntries(existingEntry, nextEntry) !== 0;
}

const initialState: FriendRosterState = {
    currentUserId: null,
    loadStatus: 'idle',
    detail: '',
    lastLoadedAt: null,
    friendsById: {},
    presenceRevById: {},
    presenceGeneration: null,
    orderedFriendIds: [],
    onlineIds: [],
    activeIds: [],
    offlineIds: []
};

function isStalePresence(
    presenceRevById: Record<string, number>,
    presenceGeneration: number | null,
    userId: string,
    entry: FriendPatchEntry
): boolean {
    if (!entry.presence || entry.generation === undefined) {
        return false;
    }
    if (presenceGeneration === null) {
        return false;
    }
    if (entry.generation !== presenceGeneration) {
        return entry.generation < presenceGeneration;
    }
    const existingRev = presenceRevById[userId];
    return existingRev !== undefined && existingRev > entry.presence.rev;
}

export const useFriendRosterStore = create<FriendRosterStore>((set) => ({
    ...initialState,
    setRosterLoading(currentUserId: string, detail = '') {
        set((state) => {
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
                presenceRevById: {},
                presenceGeneration: null,
                orderedFriendIds: [],
                onlineIds: [],
                activeIds: [],
                offlineIds: []
            };
        });
    },
    setRosterReady(detail = '') {
        set((state) => ({
            ...state,
            loadStatus: 'ready',
            detail,
            lastLoadedAt: new Date().toISOString()
        }));
    },
    setRosterSnapshot({
        currentUserId,
        friendsById,
        presenceById,
        generation,
        detail = ''
    }: FriendRosterSnapshotInput) {
        set((state) => {
            if (
                generation != null &&
                state.presenceGeneration != null &&
                generation < state.presenceGeneration
            ) {
                return state;
            }
            const nextPresenceRevById: Record<string, number> = {};
            const sourceFriendsById = normalizeFriendRecordMap(friendsById);
            for (const [userId, friend] of Object.entries(sourceFriendsById)) {
                const presence = presenceById?.[userId];
                if (presence) {
                    nextPresenceRevById[userId] = presence.rev;
                    sourceFriendsById[userId] = {
                        ...friend,
                        $presence: presence.view
                    };
                }
            }
            const nextFriendsById =
                normalizeRosterSnapshotFriends(sourceFriendsById);
            if (
                generation !== undefined &&
                generation !== null &&
                generation === state.presenceGeneration
            ) {
                for (const [userId, existingRev] of Object.entries(
                    state.presenceRevById
                )) {
                    const incomingRev = nextPresenceRevById[userId];
                    const existingFriend = state.friendsById[userId];
                    if (
                        incomingRev !== undefined &&
                        existingFriend &&
                        existingRev > incomingRev
                    ) {
                        nextFriendsById[userId] = existingFriend;
                        nextPresenceRevById[userId] = existingRev;
                    }
                }
            }
            return {
                currentUserId: normalizeUserId(currentUserId) || null,
                loadStatus: 'ready',
                detail,
                lastLoadedAt: new Date().toISOString(),
                friendsById: nextFriendsById,
                presenceRevById: nextPresenceRevById,
                presenceGeneration: generation ?? state.presenceGeneration,
                ...buildRosterOrdering(nextFriendsById)
            };
        });
    },
    setRosterError(detail: string) {
        set((state) => ({
            ...state,
            loadStatus: 'error',
            detail,
            lastLoadedAt: new Date().toISOString()
        }));
    },
    applyFriendPatch({
        detail = '',
        ...entry
    }: FriendPatchEntry & { detail?: string }) {
        useFriendRosterStore.getState().applyFriendPatches([entry], detail);
    },
    applyFriendPatches(patches: FriendPatchEntry[] = [], detail = '') {
        set((state) => {
            if (!Array.isArray(patches) || patches.length === 0) {
                return state;
            }

            let changed = false;
            let orderingDirty = false;
            let friendsById = state.friendsById;
            let presenceRevById = state.presenceRevById;
            let presenceGeneration = state.presenceGeneration;

            for (const entry of patches) {
                const basePatch: FriendRecordInput = isRecord(entry?.patch)
                    ? entry.patch
                    : {};
                const patch: FriendRecordInput = entry.presence
                    ? { ...basePatch, $presence: entry.presence.view }
                    : basePatch;
                const normalizedUserId = normalizeUserId(
                    entry?.userId || patch?.id
                );
                if (
                    !normalizedUserId ||
                    isStalePresence(
                        presenceRevById,
                        presenceGeneration,
                        normalizedUserId,
                        entry
                    )
                ) {
                    continue;
                }
                if (entry.presence) {
                    if (
                        presenceRevById[normalizedUserId] !== entry.presence.rev
                    ) {
                        if (presenceRevById === state.presenceRevById) {
                            presenceRevById = { ...presenceRevById };
                        }
                        presenceRevById[normalizedUserId] = entry.presence.rev;
                        changed = true;
                    }
                    if (entry.generation !== undefined) {
                        presenceGeneration = entry.generation;
                    }
                }

                const existingEntry = friendsById[normalizedUserId] ?? null;
                const mergedUser: FriendRecordInput = {
                    ...(existingEntry ??
                        createFallbackFriendUser(normalizedUserId)),
                    ...patch,
                    id: normalizedUserId
                };
                const normalizedEntry = normalizeFriendEntry(
                    mergedUser,
                    existingEntry ?? {
                        id: normalizedUserId,
                        userId: normalizedUserId,
                        displayName: normalizedUserId,
                        friendNumber: 0
                    }
                );
                const entryOrderingDirty = friendEntryNeedsOrderingUpdate(
                    existingEntry,
                    normalizedEntry
                );
                if (!entryOrderingDirty && existingEntry === normalizedEntry) {
                    continue;
                }
                if (friendsById === state.friendsById) {
                    friendsById = { ...friendsById };
                }
                if (entryOrderingDirty) {
                    orderingDirty = true;
                }
                friendsById[normalizedUserId] = normalizedEntry;
                changed = true;
            }

            if (!changed) {
                return state;
            }

            const nextState = {
                ...state,
                ...(orderingDirty ? buildRosterOrdering(friendsById) : {}),
                friendsById,
                presenceRevById,
                presenceGeneration,
                loadStatus:
                    state.loadStatus === 'idle' ? 'ready' : state.loadStatus,
                detail: detail || state.detail,
                lastLoadedAt: new Date().toISOString()
            };
            return nextState;
        });
    },
    removeFriend(userId: string, detail = '') {
        set((state) => {
            const normalizedUserId = normalizeUserId(userId);
            if (!normalizedUserId || !state.friendsById[normalizedUserId]) {
                return state;
            }

            const friendsById: FriendRosterById = { ...state.friendsById };
            delete friendsById[normalizedUserId];
            const presenceRevById = { ...state.presenceRevById };
            delete presenceRevById[normalizedUserId];

            const nextState = {
                ...state,
                ...buildRosterOrdering(friendsById),
                friendsById,
                presenceRevById,
                detail: detail || state.detail,
                lastLoadedAt: new Date().toISOString()
            };
            return nextState;
        });
    },
    resetRoster() {
        set(initialState);
    }
}));
