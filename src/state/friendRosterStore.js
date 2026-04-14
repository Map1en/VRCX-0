import { computeTrustLevel, computeUserPlatform } from '@/shared/utils/userTransforms.js';
import { create } from 'zustand';

function normalizeUserId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeStateBucket(value) {
    const normalized = normalizeUserId(value).toLowerCase();
    if (normalized === 'online' || normalized === 'active' || normalized === 'offline') {
        return normalized;
    }
    return '';
}

function getDisplayName(user) {
    return user?.displayName || user?.username || user?.id || '';
}

function createFallbackFriendUser(userId, existingRow) {
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

function normalizeFriendEntry(friend, stateBucket, existingRow) {
    const fallbackUserId = normalizeUserId(existingRow?.id || existingRow?.userId);
    const source = friend ?? createFallbackFriendUser(fallbackUserId, existingRow);
    const tags = Array.isArray(source.tags) ? source.tags : [];
    const trust = computeTrustLevel(tags, source.developerType || '');
    const friendNumber = Number.parseInt(
        source?.friendNumber ?? source?.$friendNumber ?? existingRow?.friendNumber ?? existingRow?.$friendNumber ?? 0,
        10
    ) || 0;
    const displayName = getDisplayName(source) || existingRow?.displayName || source.id;

    return {
        ...source,
        id: normalizeUserId(source.id),
        displayName,
        state: stateBucket,
        stateBucket,
        friendNumber,
        trustLevel: trust.trustLevel,
        $friendNumber: friendNumber,
        $trustLevel: trust.trustLevel,
        $trustClass: trust.trustClass,
        $trustSortNum: trust.trustSortNum,
        $isModerator: trust.isModerator,
        $isTroll: trust.isTroll,
        $isProbableTroll: trust.isProbableTroll,
        $platform: computeUserPlatform(source.platform, source.last_platform)
    };
}

function compareFriendEntries(left, right) {
    const leftNumber = Number.parseInt(left?.friendNumber ?? left?.$friendNumber ?? 0, 10) || 0;
    const rightNumber =
        Number.parseInt(right?.friendNumber ?? right?.$friendNumber ?? 0, 10) || 0;
    const leftHasNumber = leftNumber > 0;
    const rightHasNumber = rightNumber > 0;

    if (leftHasNumber !== rightHasNumber) {
        return leftHasNumber ? -1 : 1;
    }

    if (leftHasNumber && rightHasNumber && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
    }

    const leftName = String(left?.displayName || left?.id || '').toLowerCase();
    const rightName = String(right?.displayName || right?.id || '').toLowerCase();
    const nameComparison = leftName.localeCompare(rightName);
    if (nameComparison !== 0) {
        return nameComparison;
    }

    return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function buildBucketIds(friendIds, friendsById, stateBucket) {
    return friendIds
        .filter((friendId) => friendsById[friendId]?.stateBucket === stateBucket)
        .sort((leftId, rightId) => compareFriendEntries(friendsById[leftId], friendsById[rightId]));
}

function buildRosterOrdering(friendsById) {
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

const initialState = {
    currentUserId: null,
    loadStatus: 'idle',
    detail: '',
    lastLoadedAt: null,
    friendsById: {},
    orderedFriendIds: [],
    onlineIds: [],
    activeIds: [],
    offlineIds: []
};

export const useFriendRosterStore = create((set) => ({
    ...initialState,
    setRosterLoading(currentUserId, detail = '') {
        set({
            currentUserId,
            loadStatus: 'running',
            detail,
            lastLoadedAt: null,
            friendsById: {},
            orderedFriendIds: [],
            onlineIds: [],
            activeIds: [],
            offlineIds: []
        });
    },
    setRosterSnapshot({
        currentUserId,
        friendsById,
        orderedFriendIds,
        onlineIds,
        activeIds,
        offlineIds,
        detail = ''
    }) {
        set({
            currentUserId,
            loadStatus: 'ready',
            detail,
            lastLoadedAt: new Date().toISOString(),
            friendsById,
            orderedFriendIds,
            onlineIds,
            activeIds,
            offlineIds
        });
    },
    setRosterError(detail) {
        set((state) => ({
            ...state,
            loadStatus: 'error',
            detail,
            lastLoadedAt: new Date().toISOString()
        }));
    },
    applyFriendPatch({ userId, patch = {}, stateBucket, detail = '' }) {
        set((state) => {
            const normalizedUserId = normalizeUserId(userId || patch?.id);
            if (!normalizedUserId) {
                return state;
            }

            const existingEntry = state.friendsById[normalizedUserId] ?? null;
            const nextStateBucket =
                normalizeStateBucket(stateBucket) ||
                normalizeStateBucket(patch?.state) ||
                normalizeStateBucket(existingEntry?.stateBucket) ||
                normalizeStateBucket(existingEntry?.state) ||
                'offline';
            const mergedUser = {
                ...(existingEntry ?? createFallbackFriendUser(normalizedUserId, existingEntry)),
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
            const friendsById = {
                ...state.friendsById,
                [normalizedUserId]: normalizedEntry
            };
            return {
                ...state,
                ...buildRosterOrdering(friendsById),
                friendsById,
                loadStatus: state.loadStatus === 'idle' ? 'ready' : state.loadStatus,
                detail: detail || state.detail,
                lastLoadedAt: new Date().toISOString()
            };
        });
    },
    applyFriendPatches(patches = [], detail = '') {
        set((state) => {
            if (!Array.isArray(patches) || patches.length === 0) {
                return state;
            }

            let changed = false;
            const friendsById = { ...state.friendsById };

            for (const entry of patches) {
                const patch = entry?.patch && typeof entry.patch === 'object' ? entry.patch : {};
                const normalizedUserId = normalizeUserId(entry?.userId || patch?.id);
                if (!normalizedUserId) {
                    continue;
                }

                const existingEntry = friendsById[normalizedUserId] ?? null;
                const nextStateBucket =
                    normalizeStateBucket(entry?.stateBucket) ||
                    normalizeStateBucket(patch?.state) ||
                    normalizeStateBucket(existingEntry?.stateBucket) ||
                    normalizeStateBucket(existingEntry?.state) ||
                    'offline';
                const mergedUser = {
                    ...(existingEntry ?? createFallbackFriendUser(normalizedUserId, existingEntry)),
                    ...patch,
                    id: normalizedUserId
                };
                friendsById[normalizedUserId] = normalizeFriendEntry(
                    mergedUser,
                    nextStateBucket,
                    existingEntry ?? {
                        id: normalizedUserId,
                        userId: normalizedUserId,
                        displayName: normalizedUserId,
                        friendNumber: 0
                    }
                );
                changed = true;
            }

            if (!changed) {
                return state;
            }

            return {
                ...state,
                ...buildRosterOrdering(friendsById),
                friendsById,
                loadStatus: state.loadStatus === 'idle' ? 'ready' : state.loadStatus,
                detail: detail || state.detail,
                lastLoadedAt: new Date().toISOString()
            };
        });
    },
    removeFriend(userId, detail = '') {
        set((state) => {
            const normalizedUserId = normalizeUserId(userId);
            if (!normalizedUserId || !state.friendsById[normalizedUserId]) {
                return state;
            }

            const friendsById = { ...state.friendsById };
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
