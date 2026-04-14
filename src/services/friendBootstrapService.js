import {
    configRepository,
    friendLogRepository,
    vrchatFriendRepository
} from '@/repositories/index.js';
import { computeTrustLevel, computeUserPlatform } from '@/shared/utils/userTransforms.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { syncStartupServicesTask } from './startupServicesStatus.js';

const activeBootstraps = new WeakMap();
const MISSING_FRIEND_CONCURRENCY = 4;

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

function addStateBucketIds(stateById, ids, state) {
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

function buildFriendStateMap(currentUserSnapshot) {
    const stateById = new Map();

    addStateBucketIds(stateById, currentUserSnapshot?.friends, 'offline');
    addStateBucketIds(stateById, currentUserSnapshot?.offlineFriends, 'offline');
    addStateBucketIds(stateById, currentUserSnapshot?.activeFriends, 'active');
    addStateBucketIds(stateById, currentUserSnapshot?.onlineFriends, 'online');

    return stateById;
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
    const source = friend ?? createFallbackFriendUser(existingRow?.userId, existingRow);
    const tags = Array.isArray(source.tags) ? source.tags : [];
    const trust = computeTrustLevel(tags, source.developerType || '');
    const friendNumber = Number.parseInt(
        source?.friendNumber ?? source?.$friendNumber ?? existingRow?.friendNumber ?? existingRow?.$friendNumber ?? 0,
        10
    ) || 0;
    const displayName = getDisplayName(source) || existingRow?.displayName || source.id;

    return {
        ...source,
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
    const rightNumber = Number.parseInt(right?.friendNumber ?? right?.$friendNumber ?? 0, 10) || 0;
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

function buildBucketIds(expectedIds, friendsById, stateBucket) {
    return expectedIds
        .filter((userId) => friendsById[userId]?.stateBucket === stateBucket)
        .sort((leftId, rightId) => compareFriendEntries(friendsById[leftId], friendsById[rightId]));
}

function isCurrentBootstrapTarget(userId, currentUserSnapshot) {
    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();

    return (
        runtimeState.auth.currentUserId === userId &&
        runtimeState.auth.currentUserSnapshot === currentUserSnapshot &&
        sessionState.isLoggedIn &&
        sessionState.sessionPhase === 'ready'
    );
}

async function fetchMissingFriends(userIds, endpoint) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return [];
    }

    const pending = [...userIds];
    const recoveredFriends = [];
    const workers = Array.from({
        length: Math.min(MISSING_FRIEND_CONCURRENCY, pending.length)
    }, async () => {
        while (pending.length > 0) {
            const userId = pending.shift();
            if (!userId) {
                continue;
            }

            try {
                const response = await vrchatFriendRepository.getUser({ userId, endpoint });
                if (response?.json?.id) {
                    recoveredFriends.push(response.json);
                }
            } catch (error) {
                console.warn(`Friend bootstrap could not recover ${userId}:`, error);
            }
        }
    });

    await Promise.all(workers);
    return recoveredFriends;
}

async function runFriendBootstrap({ userId, endpoint = '', currentUserSnapshot }) {
    const normalizedUserId = normalizeUserId(userId || currentUserSnapshot?.id);
    if (!normalizedUserId) {
        throw new Error('Friend bootstrap requires an authenticated user id.');
    }

    const displayName = getDisplayName(currentUserSnapshot) || normalizedUserId;
    const stateById = buildFriendStateMap(currentUserSnapshot);
    const expectedIds = Array.from(stateById.keys());
    const existingRows = await friendLogRepository.getFriendLogCurrent(normalizedUserId);
    const existingRowsById = new Map(existingRows.map((row) => [row.userId, row]));

    useFriendRosterStore.getState().setRosterLoading(
        normalizedUserId,
        `Loading the friend roster baseline for ${displayName}.`
    );
    useRuntimeStore.getState().setStartupTask(
        'services',
        'running',
        `Loading the friend roster baseline for ${displayName}.`
    );
    useSessionStore.getState().setFriendsLoaded(false);

    const [onlineFriends, offlineFriends] = await Promise.all([
        vrchatFriendRepository.getAllFriends({ endpoint, offline: false }),
        vrchatFriendRepository.getAllFriends({ endpoint, offline: true })
    ]);

    const fetchedFriendsById = new Map();
    for (const friend of [...onlineFriends, ...offlineFriends]) {
        const friendId = normalizeUserId(friend?.id);
        if (!friendId) {
            continue;
        }
        fetchedFriendsById.set(friendId, friend);
    }

    const missingIds = expectedIds.filter((friendId) => !fetchedFriendsById.has(friendId));
    const recoveredFriends = await fetchMissingFriends(missingIds, endpoint);
    for (const friend of recoveredFriends) {
        const friendId = normalizeUserId(friend?.id);
        if (!friendId) {
            continue;
        }
        fetchedFriendsById.set(friendId, friend);
    }

    const includedIds = Array.from(new Set([...expectedIds, ...fetchedFriendsById.keys()]));
    const friendOrderSourceIds = Array.isArray(currentUserSnapshot?.friends) && currentUserSnapshot.friends.length
        ? currentUserSnapshot.friends
        : includedIds;
    const friendOrderNumbers = new Map(
        friendOrderSourceIds
            .map((friendId, index) => [normalizeUserId(friendId), index + 1])
            .filter(([friendId]) => Boolean(friendId))
    );
    const friendsById = {};
    const friendLogRows = [];

    for (const friendId of includedIds) {
        const friend = fetchedFriendsById.get(friendId);
        const existingRow = existingRowsById.get(friendId) ?? {
            userId: friendId,
            displayName: getDisplayName(friend) || friendId,
            trustLevel: 'Visitor',
            friendNumber: 0
        };
        if (!(Number.parseInt(existingRow.friendNumber ?? existingRow.$friendNumber ?? 0, 10) > 0)) {
            existingRow.friendNumber = friendOrderNumbers.get(friendId) || 0;
        }
        const stateBucket =
            normalizeStateBucket(stateById.get(friendId)) ||
            normalizeStateBucket(friend?.stateBucket) ||
            normalizeStateBucket(friend?.state) ||
            'offline';
        const normalizedFriend = normalizeFriendEntry(friend, stateBucket, existingRow);

        friendsById[friendId] = normalizedFriend;
        friendLogRows.push({
            userId: friendId,
            displayName: normalizedFriend.displayName,
            trustLevel: normalizedFriend.$trustLevel,
            friendNumber: normalizedFriend.$friendNumber
        });
    }

    const onlineIds = buildBucketIds(includedIds, friendsById, 'online');
    const activeIds = buildBucketIds(includedIds, friendsById, 'active');
    const offlineIds = buildBucketIds(includedIds, friendsById, 'offline');
    const orderedFriendIds = [...onlineIds, ...activeIds, ...offlineIds];

    await friendLogRepository.replaceFriendLogCurrent(normalizedUserId, friendLogRows);
    await configRepository.setBool(`friendLogInit_${normalizedUserId}`, true);

    const recoveredCount = recoveredFriends.length;
    const detail = [
        `Friend roster baseline loaded for ${displayName} (${orderedFriendIds.length} profiles).`,
        missingIds.length
            ? `Recovered ${recoveredCount} profile(s) from direct user lookups.`
            : 'No direct user lookup fallback was needed.'
    ].join(' ');

    if (!isCurrentBootstrapTarget(normalizedUserId, currentUserSnapshot)) {
        return {
            userId: normalizedUserId,
            count: orderedFriendIds.length,
            detail,
            stale: true
        };
    }

    useFriendRosterStore.getState().setRosterSnapshot({
        currentUserId: normalizedUserId,
        friendsById,
        orderedFriendIds,
        onlineIds,
        activeIds,
        offlineIds,
        detail
    });
    useSessionStore.getState().setFriendsLoaded(true);
    syncStartupServicesTask([detail]);

    return {
        userId: normalizedUserId,
        count: orderedFriendIds.length,
        detail,
        stale: false
    };
}

export function bootstrapFriendRoster(options) {
    const normalizedUserId = normalizeUserId(options?.userId || options?.currentUserSnapshot?.id);
    const currentUserSnapshot =
        options?.currentUserSnapshot && typeof options.currentUserSnapshot === 'object'
            ? options.currentUserSnapshot
            : null;
    if (!normalizedUserId || !currentUserSnapshot) {
        return Promise.reject(new Error('Friend bootstrap requires an authenticated user id.'));
    }

    if (activeBootstraps.has(currentUserSnapshot)) {
        return activeBootstraps.get(currentUserSnapshot);
    }

    const promise = runFriendBootstrap(options)
        .catch((error) => {
            if (isCurrentBootstrapTarget(normalizedUserId, currentUserSnapshot)) {
                useFriendRosterStore.getState().setRosterError(
                    error instanceof Error ? error.message : String(error)
                );
                useSessionStore.getState().setFriendsLoaded(false);
                useRuntimeStore.getState().setStartupTask(
                    'services',
                    'error',
                    error instanceof Error ? error.message : String(error)
                );
            }

            throw error;
        })
        .finally(() => {
            activeBootstraps.delete(currentUserSnapshot);
        });

    activeBootstraps.set(currentUserSnapshot, promise);
    return promise;
}
