import {
    configRepository,
    friendLogRepository,
    userProfileRepository,
    vrchatFriendRepository
} from '@/repositories/index.js';
import {
    computeTrustLevel,
    computeUserPlatform
} from '@/shared/utils/userTransforms.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import {
    recordFriendPatch,
    recordFriendRosterFacts
} from './domainIngestionService.js';
import { syncCurrentRealtimeFriendBaseline } from './realtimeFriendBaselineService.js';
import { syncStartupServicesTask } from './startupServicesStatus.js';

const activeBootstraps = new Map<string, Promise<unknown>>();
const friendLogMutationQueues = new Map<string, Promise<unknown>>();
const explicitFriendLogAddIntents = new Map<string, symbol>();
const MISSING_FRIEND_CONCURRENCY = 4;
const FRIEND_REMOVAL_STATUS_CONFIRMATION_LIMIT = 50;
const FRIEND_ADDITION_RECONCILIATION_LIMIT = 50;

function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeStateBucket(value: unknown) {
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

function getDisplayName(user: Record<string, any> | null | undefined) {
    return user?.displayName || user?.username || user?.id || '';
}

function getMeaningfulDisplayName(
    user: Record<string, any> | null | undefined,
    userId = ''
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

function enqueueFriendLogMutation(userId: unknown, mutation: () => unknown) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return Promise.reject(
            new Error('Friend log mutation requires a current user id.')
        );
    }

    const previous =
        friendLogMutationQueues.get(normalizedUserId) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(mutation);
    let queued;
    queued = run
        .catch(() => {})
        .finally(() => {
            if (friendLogMutationQueues.get(normalizedUserId) === queued) {
                friendLogMutationQueues.delete(normalizedUserId);
            }
        });
    friendLogMutationQueues.set(normalizedUserId, queued);
    return run;
}

function getExplicitFriendLogAddIntentKey(currentUserId, targetUserId) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const normalizedTargetUserId = normalizeUserId(targetUserId);
    if (
        !normalizedCurrentUserId ||
        !normalizedTargetUserId ||
        normalizedCurrentUserId === normalizedTargetUserId
    ) {
        return '';
    }
    return `${normalizedCurrentUserId}\u0000${normalizedTargetUserId}`;
}

export function registerFriendLogExplicitAddIntent({
    currentUserId,
    targetUserId
}) {
    const key = getExplicitFriendLogAddIntentKey(currentUserId, targetUserId);
    if (!key) {
        return () => {};
    }

    const token = Symbol('friend-log-explicit-add');
    explicitFriendLogAddIntents.set(key, token);
    return () => {
        if (explicitFriendLogAddIntents.get(key) === token) {
            explicitFriendLogAddIntents.delete(key);
        }
    };
}

function hasFriendLogExplicitAddIntent(currentUserId, targetUserId) {
    const key = getExplicitFriendLogAddIntentKey(currentUserId, targetUserId);
    return Boolean(key) && explicitFriendLogAddIntents.has(key);
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
    addStateBucketIds(
        stateById,
        currentUserSnapshot?.offlineFriends,
        'offline'
    );
    addStateBucketIds(stateById, currentUserSnapshot?.activeFriends, 'active');
    addStateBucketIds(stateById, currentUserSnapshot?.onlineFriends, 'online');

    return stateById;
}

function getFriendLogInitKey(userId) {
    return `friendLogInit_${userId}`;
}

function buildSnapshotFriendIdSet(currentUserSnapshot) {
    const friendIds = new Set();

    if (Array.isArray(currentUserSnapshot?.friends)) {
        for (const value of currentUserSnapshot.friends) {
            const userId = normalizeUserId(value);
            if (userId) {
                friendIds.add(userId);
            }
        }
    }

    return {
        friendIds,
        hasFriendList: Array.isArray(currentUserSnapshot?.friends)
    };
}

function buildUnfriendHistoryEntry(
    row: Record<string, any>,
    createdAt: string
) {
    const userId = normalizeUserId(row?.userId);
    if (!userId) {
        return null;
    }

    return {
        created_at: createdAt,
        type: 'Unfriend',
        userId,
        displayName: row?.displayName || userId,
        friendNumber: row?.friendNumber ?? row?.$friendNumber ?? null
    };
}

function buildFriendHistoryEntry(row: Record<string, any>, createdAt: string) {
    const userId = normalizeUserId(row?.userId || row?.id);
    if (!userId) {
        return null;
    }

    return {
        created_at: createdAt,
        type: 'Friend',
        userId,
        displayName: row?.displayName || row?.username || userId,
        trustLevel: row?.trustLevel ?? row?.$trustLevel ?? '',
        friendNumber: row?.friendNumber ?? row?.$friendNumber ?? null
    };
}

function buildFriendLogRemovalCandidates({
    currentUserId,
    existingRows,
    fetchedFriendIds,
    snapshotFriendIds,
    hasFriendList
}) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const candidates = [];

    for (const row of Array.isArray(existingRows) ? existingRows : []) {
        const userId = normalizeUserId(row?.userId);
        if (
            !userId ||
            userId === normalizedCurrentUserId ||
            (fetchedFriendIds.has(userId) &&
                (!hasFriendList || snapshotFriendIds.has(userId)))
        ) {
            continue;
        }

        candidates.push(row);
    }

    return candidates;
}

async function confirmFriendLogRemovalHistoryEntries({
    candidates,
    endpoint,
    createdAt
}) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return {
            removedRows: [],
            historyEntries: []
        };
    }

    if (candidates.length > FRIEND_REMOVAL_STATUS_CONFIRMATION_LIMIT) {
        console.warn(
            `Friend bootstrap skipped ${candidates.length} unfriend candidates; refusing to confirm a large roster drop.`
        );
        return {
            removedRows: [],
            historyEntries: []
        };
    }

    const pending = [...candidates];
    const removedRows = [];
    const historyEntries = [];
    const workers = Array.from(
        {
            length: Math.min(MISSING_FRIEND_CONCURRENCY, pending.length)
        },
        async () => {
            while (pending.length > 0) {
                const row = pending.shift();
                const targetUserId = normalizeUserId(row?.userId);
                if (!targetUserId) {
                    continue;
                }

                try {
                    const response =
                        await vrchatFriendRepository.getFriendStatus({
                            userId: targetUserId,
                            endpoint
                        });
                    if ((response?.json as any)?.isFriend !== false) {
                        continue;
                    }
                    const entry = buildUnfriendHistoryEntry(row, createdAt);
                    if (entry) {
                        removedRows.push(row);
                        historyEntries.push(entry);
                    }
                } catch (error) {
                    console.warn(
                        `Friend bootstrap could not confirm unfriend ${targetUserId}:`,
                        error
                    );
                }
            }
        }
    );

    await Promise.all(workers);

    return {
        removedRows,
        historyEntries
    };
}

export async function recordFriendLogFriendByUserId({
    currentUserId,
    targetUserId,
    targetUser,
    stateBucket,
    nowIso = () => new Date().toJSON()
}) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const normalizedTargetUserId = normalizeUserId(
        targetUserId || targetUser?.id
    );
    if (
        !normalizedCurrentUserId ||
        !normalizedTargetUserId ||
        normalizedCurrentUserId === normalizedTargetUserId
    ) {
        return {
            userId: normalizedCurrentUserId,
            targetUserId: normalizedTargetUserId,
            count: 0,
            inserted: false,
            historyCount: 0
        };
    }

    return enqueueFriendLogMutation(normalizedCurrentUserId, async () => {
        const explicitAddIntentKey = getExplicitFriendLogAddIntentKey(
            normalizedCurrentUserId,
            normalizedTargetUserId
        );
        const hasExplicitAddIntent =
            Boolean(explicitAddIntentKey) &&
            explicitFriendLogAddIntents.has(explicitAddIntentKey);
        const existingRows = (await friendLogRepository.getFriendLogCurrent(
            normalizedCurrentUserId
        )) as Record<string, any>[];
        const existingRow = existingRows.find(
            (entry) => normalizeUserId(entry?.userId) === normalizedTargetUserId
        );
        const maxFriendNumber = existingRows.reduce((maxValue, row) => {
            const friendNumber =
                Number.parseInt(
                    row?.friendNumber ?? row?.$friendNumber ?? 0,
                    10
                ) || 0;
            return Math.max(maxValue, friendNumber);
        }, 0);
        const nextFriendNumber =
            Number.parseInt(
                targetUser?.friendNumber ??
                    targetUser?.$friendNumber ??
                    existingRow?.friendNumber ??
                    existingRow?.$friendNumber ??
                    0,
                10
            ) ||
            (maxFriendNumber > 0
                ? maxFriendNumber + 1
                : existingRows.length + 1);
        const source =
            targetUser && typeof targetUser === 'object'
                ? {
                      ...targetUser,
                      id: normalizedTargetUserId,
                      friendNumber: nextFriendNumber,
                      $friendNumber: nextFriendNumber
                  }
                : {
                      id: normalizedTargetUserId,
                      friendNumber: nextFriendNumber,
                      $friendNumber: nextFriendNumber
                  };
        const normalizedStateBucket =
            normalizeStateBucket(stateBucket) ||
            normalizeStateBucket(source.stateBucket) ||
            normalizeStateBucket(source.state) ||
            'offline';
        const normalizedFriend = normalizeFriendEntry(
            source,
            normalizedStateBucket,
            existingRow ?? {
                userId: normalizedTargetUserId,
                displayName: getDisplayName(source) || normalizedTargetUserId,
                trustLevel: 'Visitor',
                friendNumber: nextFriendNumber
            }
        );
        const currentEntry = {
            userId: normalizedTargetUserId,
            displayName: normalizedFriend.displayName,
            trustLevel: normalizedFriend.$trustLevel,
            friendNumber: normalizedFriend.$friendNumber
        };
        const historyEntry = buildFriendHistoryEntry(currentEntry, nowIso());

        const result = await friendLogRepository.upsertFriendLogCurrent(
            normalizedCurrentUserId,
            currentEntry,
            {
                historyEntry,
                forceHistory: hasExplicitAddIntent
            }
        );
        if (hasExplicitAddIntent) {
            explicitFriendLogAddIntents.delete(explicitAddIntentKey);
        }
        return result;
    });
}

export function syncFriendRosterStateFromCurrentUserSnapshot(
    currentUserSnapshot,
    detail = ''
) {
    const stateById = buildFriendStateMap(currentUserSnapshot);
    if (!stateById.size) {
        return false;
    }

    useFriendRosterStore.getState().applyFriendPatches(
        Array.from(stateById.entries()).map(([userId, stateBucket]) => ({
            userId,
            stateBucket,
            patch: {
                id: userId,
                state: stateBucket
            }
        })),
        detail
    );
    for (const [userId, stateBucket] of stateById.entries()) {
        recordFriendPatch({
            endpoint: useRuntimeStore.getState().auth.currentUserEndpoint,
            userId,
            stateBucket,
            patch: {
                id: userId,
                state: stateBucket
            }
        });
    }
    return true;
}

export async function recordFriendLogUnfriendByUserId({
    currentUserId,
    targetUserId,
    nowIso = () => new Date().toJSON()
}) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const normalizedTargetUserId = normalizeUserId(targetUserId);
    if (!normalizedCurrentUserId || !normalizedTargetUserId) {
        return {
            userId: normalizedCurrentUserId,
            targetUserId: normalizedTargetUserId,
            removedCount: 0,
            historyCount: 0
        };
    }

    return enqueueFriendLogMutation(normalizedCurrentUserId, async () => {
        const existingRows = (await friendLogRepository.getFriendLogCurrent(
            normalizedCurrentUserId
        )) as Record<string, any>[];
        const row = existingRows.find(
            (entry) => normalizeUserId(entry?.userId) === normalizedTargetUserId
        );
        const historyEntry = row
            ? buildUnfriendHistoryEntry(row, nowIso())
            : null;
        if (!historyEntry) {
            return {
                userId: normalizedCurrentUserId,
                targetUserId: normalizedTargetUserId,
                removedCount: 0,
                historyCount: 0
            };
        }

        const result = await friendLogRepository.deleteFriendLogCurrentArray(
            normalizedCurrentUserId,
            [normalizedTargetUserId],
            { historyEntries: [historyEntry] }
        );

        return {
            userId: normalizedCurrentUserId,
            targetUserId: normalizedTargetUserId,
            removedCount: result?.count ?? 0,
            historyCount: result?.historyCount ?? 0
        };
    });
}

function createFallbackFriendUser(
    userId: unknown,
    existingRow: Record<string, any>
) {
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

function normalizeFriendEntry(
    friend: Record<string, any> | null | undefined,
    stateBucket: string,
    existingRow: Record<string, any>
) {
    const source =
        friend ?? createFallbackFriendUser(existingRow?.userId, existingRow);
    const sourceRecord = source as Record<string, any>;
    const tags = Array.isArray(sourceRecord.tags) ? sourceRecord.tags : [];
    const trust = computeTrustLevel(tags, sourceRecord.developerType || '');
    const explicitTrustLevel =
        sourceRecord.$trustLevel || sourceRecord.trustLevel || '';
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
            sourceRecord?.friendNumber ??
                sourceRecord?.$friendNumber ??
                existingRow?.friendNumber ??
                existingRow?.$friendNumber ??
                0,
            10
        ) || 0;
    const displayName =
        getMeaningfulDisplayName(
            sourceRecord,
            sourceRecord.id || existingRow?.userId
        ) ||
        existingRow?.displayName ||
        getDisplayName(sourceRecord) ||
        sourceRecord.id;

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
            sourceRecord.platform,
            sourceRecord.last_platform
        )
    };
}

function compareFriendEntries(
    left: Record<string, any>,
    right: Record<string, any>
) {
    const leftNumber =
        Number.parseInt(left?.friendNumber ?? left?.$friendNumber ?? 0, 10) ||
        0;
    const rightNumber =
        Number.parseInt(right?.friendNumber ?? right?.$friendNumber ?? 0, 10) ||
        0;
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

function buildBucketIds(expectedIds, friendsById, stateBucket) {
    return expectedIds
        .filter((userId) => friendsById[userId]?.stateBucket === stateBucket)
        .sort((leftId, rightId) =>
            compareFriendEntries(friendsById[leftId], friendsById[rightId])
        );
}

function bootstrapTargetKey(userId, endpoint = '') {
    return `${normalizeUserId(userId)}\u0000${String(endpoint || '')}`;
}

function isCurrentBootstrapTarget(userId, endpoint = '') {
    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();

    return (
        runtimeState.auth.currentUserId === userId &&
        runtimeState.auth.currentUserEndpoint === String(endpoint || '') &&
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
    const workers = Array.from(
        {
            length: Math.min(MISSING_FRIEND_CONCURRENCY, pending.length)
        },
        async () => {
            while (pending.length > 0) {
                const userId = pending.shift();
                if (!userId) {
                    continue;
                }

                try {
                    const profile = await userProfileRepository.getUserProfile({
                        userId,
                        endpoint
                    });
                    if (profile?.id) {
                        recoveredFriends.push(profile);
                    }
                } catch (error) {
                    console.warn(
                        `Friend bootstrap could not recover ${userId}:`,
                        error
                    );
                }
            }
        }
    );

    await Promise.all(workers);
    return recoveredFriends;
}

async function runFriendBootstrap({
    userId,
    endpoint = '',
    currentUserSnapshot
}) {
    const normalizedUserId = normalizeUserId(userId || currentUserSnapshot?.id);
    if (!normalizedUserId) {
        throw new Error('Friend bootstrap requires an authenticated user id.');
    }

    const displayName = getDisplayName(currentUserSnapshot) || normalizedUserId;
    const stateById = buildFriendStateMap(currentUserSnapshot);
    const { friendIds: snapshotFriendIds, hasFriendList } =
        buildSnapshotFriendIdSet(currentUserSnapshot);
    const expectedIds = Array.from(
        new Set([...stateById.keys(), ...snapshotFriendIds])
    );

    useFriendRosterStore
        .getState()
        .setRosterLoading(
            normalizedUserId,
            `Loading the friend roster baseline for ${displayName}.`
        );
    useRuntimeStore
        .getState()
        .setStartupTask(
            'services',
            'running',
            `Loading the friend roster baseline for ${displayName}.`
        );
    useSessionStore.getState().setFriendsLoaded(false);

    const bootstrapResult = await enqueueFriendLogMutation(
        normalizedUserId,
        async () => {
            const friendLogInitialized = Boolean(
                await configRepository.getBool(
                    getFriendLogInitKey(normalizedUserId),
                    false
                )
            );
            const [onlineFriends, offlineFriends] = await Promise.all([
                vrchatFriendRepository.getAllFriends({
                    endpoint,
                    offline: false
                }),
                vrchatFriendRepository.getAllFriends({
                    endpoint,
                    offline: true
                })
            ]);

            const fetchedFriendsById = new Map();
            for (const friend of [...onlineFriends, ...offlineFriends]) {
                const friendId = normalizeUserId(friend?.id);
                if (!friendId) {
                    continue;
                }
                fetchedFriendsById.set(friendId, friend);
            }

            const missingIds = expectedIds.filter(
                (friendId) =>
                    !friendLogInitialized && !fetchedFriendsById.has(friendId)
            );
            const recoveredFriends = await fetchMissingFriends(
                missingIds,
                endpoint
            );
            for (const friend of recoveredFriends) {
                const friendId = normalizeUserId(friend?.id);
                if (!friendId) {
                    continue;
                }
                fetchedFriendsById.set(friendId, friend);
            }

            const existingRows = (await friendLogRepository.getFriendLogCurrent(
                normalizedUserId
            )) as Record<string, any>[];
            const existingRowsById = new Map(
                existingRows.map((row) => [normalizeUserId(row?.userId), row])
            );
            const existingIds = existingRows
                .map((row) => normalizeUserId(row?.userId))
                .filter(Boolean);
            const fetchedFriendIds = new Set(fetchedFriendsById.keys());
            const reconciliationCreatedAt = new Date().toJSON();
            const { removedRows, historyEntries } = friendLogInitialized
                ? await confirmFriendLogRemovalHistoryEntries({
                      candidates: buildFriendLogRemovalCandidates({
                          currentUserId: normalizedUserId,
                          existingRows,
                          fetchedFriendIds,
                          snapshotFriendIds,
                          hasFriendList
                      }),
                      endpoint,
                      createdAt: reconciliationCreatedAt
                  })
                : { removedRows: [], historyEntries: [] };
            const removedFriendIds = new Set(
                removedRows
                    .map((row) => normalizeUserId(row?.userId))
                    .filter(Boolean)
            );
            const includedIds = friendLogInitialized
                ? Array.from(
                      new Set([
                          ...existingIds,
                          ...(hasFriendList ? snapshotFriendIds : []),
                          ...fetchedFriendsById.keys()
                      ])
                  ).filter((friendId) => !removedFriendIds.has(friendId))
                : Array.from(
                      new Set([
                          ...existingIds,
                          ...expectedIds,
                          ...fetchedFriendsById.keys()
                      ])
                  );
            const friendOrderSourceIds =
                Array.isArray(currentUserSnapshot?.friends) &&
                currentUserSnapshot.friends.length
                    ? currentUserSnapshot.friends
                    : includedIds;
            const friendOrderNumbers = new Map(
                friendOrderSourceIds
                    .map((friendId, index) => [
                        normalizeUserId(friendId),
                        index + 1
                    ])
                    .filter(([friendId]) => Boolean(friendId))
            );
            const friendsById: Record<string, any> = {};
            const friendLogRows: Record<string, any>[] = [];
            const addedHistoryEntries: Record<string, any>[] = [];

            for (const friendId of includedIds) {
                const friend = fetchedFriendsById.get(friendId);
                const existingRow = existingRowsById.get(friendId) ?? {
                    userId: friendId,
                    displayName: getDisplayName(friend) || friendId,
                    trustLevel: 'Visitor',
                    friendNumber: 0
                };
                if (
                    !(
                        Number.parseInt(
                            existingRow.friendNumber ??
                                existingRow.$friendNumber ??
                                0,
                            10
                        ) > 0
                    )
                ) {
                    existingRow.friendNumber =
                        friendOrderNumbers.get(friendId) || 0;
                }
                const stateBucket =
                    normalizeStateBucket(stateById.get(friendId)) ||
                    normalizeStateBucket(friend?.stateBucket) ||
                    normalizeStateBucket(friend?.state) ||
                    'offline';
                const normalizedFriend = normalizeFriendEntry(
                    friend,
                    stateBucket,
                    existingRow
                );

                friendsById[friendId] = normalizedFriend;
                const friendLogRow = {
                    userId: friendId,
                    displayName: normalizedFriend.displayName,
                    trustLevel: normalizedFriend.$trustLevel,
                    friendNumber: normalizedFriend.$friendNumber
                };
                friendLogRows.push(friendLogRow);
                if (
                    friendLogInitialized &&
                    friendId !== normalizedUserId &&
                    !existingRowsById.has(friendId) &&
                    !hasFriendLogExplicitAddIntent(normalizedUserId, friendId)
                ) {
                    const entry = buildFriendHistoryEntry(
                        friendLogRow,
                        reconciliationCreatedAt
                    );
                    if (entry) {
                        addedHistoryEntries.push(entry);
                    }
                }
            }

            const safeAddedHistoryEntries =
                addedHistoryEntries.length >
                FRIEND_ADDITION_RECONCILIATION_LIMIT
                    ? []
                    : addedHistoryEntries;
            if (safeAddedHistoryEntries.length !== addedHistoryEntries.length) {
                console.warn(
                    `Friend bootstrap skipped ${addedHistoryEntries.length} friend-add candidates; refusing to write a large roster gain.`
                );
            }

            const onlineIds = buildBucketIds(
                includedIds,
                friendsById,
                'online'
            );
            const activeIds = buildBucketIds(
                includedIds,
                friendsById,
                'active'
            );
            const offlineIds = buildBucketIds(
                includedIds,
                friendsById,
                'offline'
            );
            const orderedFriendIds = [
                ...onlineIds,
                ...activeIds,
                ...offlineIds
            ];

            await friendLogRepository.replaceFriendLogCurrent(
                normalizedUserId,
                friendLogRows,
                {
                    historyEntries,
                    addedHistoryEntries: safeAddedHistoryEntries
                }
            );
            await configRepository.setBool(
                getFriendLogInitKey(normalizedUserId),
                true
            );

            return {
                friendsById,
                orderedFriendIds,
                onlineIds,
                activeIds,
                offlineIds,
                detail: ''
            };
        }
    );

    const { friendsById, orderedFriendIds, onlineIds, activeIds, offlineIds } =
        bootstrapResult as Record<string, any>;
    const detail = (bootstrapResult as Record<string, any>).detail;

    if (!isCurrentBootstrapTarget(normalizedUserId, endpoint)) {
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
    recordFriendRosterFacts({
        endpoint,
        friendsById
    });
    void syncCurrentRealtimeFriendBaseline();
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
    const normalizedUserId = normalizeUserId(
        options?.userId || options?.currentUserSnapshot?.id
    );
    const currentUserSnapshot =
        options?.currentUserSnapshot &&
        typeof options.currentUserSnapshot === 'object'
            ? options.currentUserSnapshot
            : null;
    if (!normalizedUserId || !currentUserSnapshot) {
        return Promise.reject(
            new Error('Friend bootstrap requires an authenticated user id.')
        );
    }

    const activeKey = bootstrapTargetKey(normalizedUserId, options?.endpoint);
    if (activeBootstraps.has(activeKey)) {
        return activeBootstraps.get(activeKey);
    }

    const promise = runFriendBootstrap(options)
        .catch((error) => {
            if (isCurrentBootstrapTarget(normalizedUserId, options?.endpoint)) {
                useFriendRosterStore
                    .getState()
                    .setRosterError(
                        error instanceof Error ? error.message : String(error)
                    );
                useSessionStore.getState().setFriendsLoaded(false);
                useRuntimeStore
                    .getState()
                    .setStartupTask(
                        'services',
                        'error',
                        error instanceof Error ? error.message : String(error)
                    );
            }

            throw error;
        })
        .finally(() => {
            activeBootstraps.delete(activeKey);
        });

    activeBootstraps.set(activeKey, promise);
    return promise;
}
