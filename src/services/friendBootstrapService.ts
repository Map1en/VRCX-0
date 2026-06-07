import { tauriClient } from '@/platform/tauri/client';
import friendLogRepository from '@/repositories/friendLogRepository';
import {
    computeTrustLevel,
    computeUserPlatform
} from '@/shared/utils/userTransforms';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    recordFriendPatch,
    recordFriendRosterFacts
} from './domainIngestionService';
import { notifyRuntimeVrchatAuthFailure } from './vrchatAuthErrorService';
import { syncStartupServicesTask } from './startupServicesStatus';

const activeBootstraps = new Map<string, Promise<unknown>>();
const friendLogMutationQueues = new Map<string, Promise<unknown>>();
const explicitFriendLogAddIntents = new Map<string, symbol>();
const explicitFriendLogAddIntentsHandledByBootstrap = new Set<string>();

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
    userId: any = ''
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

function getExplicitFriendLogAddIntentKey(currentUserId: any, targetUserId: any) {
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
}: any) {
    const key = getExplicitFriendLogAddIntentKey(currentUserId, targetUserId);
    if (!key) {
        return () => {};
    }

    const token = Symbol('friend-log-explicit-add');
    explicitFriendLogAddIntents.set(key, token);
    return () => {
        if (explicitFriendLogAddIntents.get(key) === token) {
            explicitFriendLogAddIntents.delete(key);
            explicitFriendLogAddIntentsHandledByBootstrap.delete(key);
        }
    };
}

function getExplicitFriendLogAddIntentUserIds(currentUserId: any) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    if (!normalizedCurrentUserId) {
        return [];
    }

    const prefix = `${normalizedCurrentUserId}\u0000`;
    return Array.from(explicitFriendLogAddIntents.keys())
        .filter((key: any) => key.startsWith(prefix))
        .map((key: any) => normalizeUserId(key.slice(prefix.length)))
        .filter(Boolean);
}

function markExplicitFriendLogAddIntentsHandledByBootstrap(
    currentUserId: any,
    targetUserIds: any
) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    if (!normalizedCurrentUserId || !Array.isArray(targetUserIds)) {
        return;
    }

    for (const targetUserId of targetUserIds) {
        const key = getExplicitFriendLogAddIntentKey(
            normalizedCurrentUserId,
            targetUserId
        );
        if (key && explicitFriendLogAddIntents.has(key)) {
            explicitFriendLogAddIntentsHandledByBootstrap.add(key);
        }
    }
}

function consumeExplicitFriendLogAddIntentHandledByBootstrap(
    currentUserId: any,
    targetUserId: any
) {
    const key = getExplicitFriendLogAddIntentKey(currentUserId, targetUserId);
    if (!key || !explicitFriendLogAddIntentsHandledByBootstrap.has(key)) {
        return false;
    }

    explicitFriendLogAddIntentsHandledByBootstrap.delete(key);
    return true;
}

function addStateBucketIds(stateById: any, ids: any, state: any) {
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

function buildFriendStateMap(currentUserSnapshot: any) {
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

function hasCompleteFriendStateSnapshot(currentUserSnapshot: any) {
    return (
        Array.isArray(currentUserSnapshot?.friends) &&
        Array.isArray(currentUserSnapshot?.offlineFriends) &&
        Array.isArray(currentUserSnapshot?.activeFriends) &&
        Array.isArray(currentUserSnapshot?.onlineFriends)
    );
}

function resolveSnapshotStateBucket(stateBucket: any) {
    return normalizeStateBucket(stateBucket) || 'offline';
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

export async function recordFriendLogFriendByUserId({
    currentUserId,
    targetUserId,
    targetUser,
    stateBucket,
    nowIso = () => new Date().toJSON()
}: any): Promise<any> {
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
        const wasHandledByBootstrap =
            consumeExplicitFriendLogAddIntentHandledByBootstrap(
                normalizedCurrentUserId,
                normalizedTargetUserId
            );
        const existingRows = (await friendLogRepository.getFriendLogCurrent(
            normalizedCurrentUserId
        )) as Record<string, any>[];
        const existingRow = existingRows.find(
            (entry: any) => normalizeUserId(entry?.userId) === normalizedTargetUserId
        );
        const maxFriendNumber = existingRows.reduce((maxValue: any, row: any) => {
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
        const currentEntry: any = {
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
                forceHistory: hasExplicitAddIntent && wasHandledByBootstrap
            }
        );
        if (hasExplicitAddIntent) {
            explicitFriendLogAddIntents.delete(explicitAddIntentKey);
        }
        return result;
    });
}

export function syncFriendRosterStateFromCurrentUserSnapshot(
    currentUserSnapshot: any,
    detail: any = ''
) {
    if (!hasCompleteFriendStateSnapshot(currentUserSnapshot)) {
        return false;
    }
    const stateById = buildFriendStateMap(currentUserSnapshot);
    const rosterStore = useFriendRosterStore.getState();
    const patchEntries = Array.from(stateById.entries()).map(
        ([userId, stateBucket]: any) => {
            const nextStateBucket = resolveSnapshotStateBucket(stateBucket);
            return {
                userId,
                stateBucket: nextStateBucket,
                patch: {
                    id: userId,
                    state: nextStateBucket
                }
            };
        }
    );

    const snapshotIds = new Set(Array.from(stateById.keys()));
    const removedIds = Object.keys(rosterStore.friendsById || {}).filter(
        (userId) => !snapshotIds.has(userId)
    );

    if (patchEntries.length) {
        rosterStore.applyFriendPatches(patchEntries, detail);
    }
    for (const userId of removedIds) {
        useFriendRosterStore.getState().removeFriend(userId, detail);
    }
    for (const { userId, stateBucket, patch } of patchEntries as any[]) {
        recordFriendPatch({
            endpoint: useRuntimeStore.getState().auth.currentUserEndpoint,
            userId,
            stateBucket,
            patch
        });
    }
    return Boolean(patchEntries.length || removedIds.length);
}

export async function recordFriendLogUnfriendByUserId({
    currentUserId,
    targetUserId,
    nowIso = () => new Date().toJSON()
}: any) {
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
            (entry: any) => normalizeUserId(entry?.userId) === normalizedTargetUserId
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

function buildFriendLogRowsById(rows: any[] = []) {
    const rowsById = new Map<string, Record<string, any>>();
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

function buildSeedRosterFriendsById(
    stateById: Map<string, string>,
    friendLogRows: any[] = []
) {
    const rowsById = buildFriendLogRowsById(friendLogRows);
    const friendsById: Record<string, any> = {};

    for (const [userId, stateBucket] of stateById.entries()) {
        const row = rowsById.get(userId) ?? {};
        const trustLevel = normalizeUserId(row?.trustLevel) || 'Visitor';
        const friendNumber =
            Number.parseInt(
                row?.friendNumber ?? row?.$friendNumber ?? 0,
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

async function seedFriendRosterFromCurrentUserSnapshot({
    normalizedUserId,
    endpoint,
    currentUserSnapshot,
    detail
}: {
    normalizedUserId: string;
    endpoint: string;
    currentUserSnapshot: any;
    detail: string;
}) {
    if (!hasCompleteFriendStateSnapshot(currentUserSnapshot)) {
        return false;
    }

    const stateById = buildFriendStateMap(currentUserSnapshot);
    let friendLogRows: any[] = [];
    try {
        friendLogRows = (await friendLogRepository.getFriendLogCurrent(
            normalizedUserId
        )) as any[];
    } catch (error) {
        console.warn('Failed to seed friend roster from friend log:', error);
    }

    if (!isCurrentBootstrapTarget(normalizedUserId, endpoint)) {
        return false;
    }

    useFriendRosterStore.getState().setRosterSeedSnapshot({
        currentUserId: normalizedUserId,
        friendsById: buildSeedRosterFriendsById(stateById, friendLogRows),
        detail
    });
    return true;
}

function bootstrapTargetKey(userId: any, endpoint: any = '') {
    return `${normalizeUserId(userId)}\u0000${String(endpoint || '')}`;
}

function isCurrentBootstrapTarget(userId: any, endpoint: any = '') {
    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();

    return (
        runtimeState.auth.currentUserId === userId &&
        runtimeState.auth.currentUserEndpoint === String(endpoint || '') &&
        sessionState.isLoggedIn &&
        sessionState.sessionPhase === 'ready'
    );
}

async function runFriendBootstrap({
    userId,
    endpoint = '',
    currentUserSnapshot,
    preserveLoadedState = false
}: any) {
    const normalizedUserId = normalizeUserId(userId || currentUserSnapshot?.id);
    if (!normalizedUserId) {
        throw new Error('Friend bootstrap requires an authenticated user id.');
    }

    const displayName = getDisplayName(currentUserSnapshot) || normalizedUserId;

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
    if (!preserveLoadedState) {
        useSessionStore.getState().setFriendsLoaded(false);
        await seedFriendRosterFromCurrentUserSnapshot({
            normalizedUserId,
            endpoint,
            currentUserSnapshot,
            detail: `Loading the full friend roster baseline for ${displayName}.`
        });
    }

    const bootstrapResult = await enqueueFriendLogMutation(
        normalizedUserId,
        async () => {
            const explicitAddIntentUserIds =
                getExplicitFriendLogAddIntentUserIds(normalizedUserId);
            const result = await tauriClient.app
                .SocialFriendRosterBaselineGet({
                    userId: normalizedUserId,
                    endpoint,
                    currentUserSnapshot,
                    explicitAddIntentUserIds
                })
                .catch((error: any) => {
                    notifyRuntimeVrchatAuthFailure(
                        error,
                        endpoint,
                        'friend roster baseline'
                    );
                    throw error;
                });
            if (!result.stale && result.snapshot) {
                markExplicitFriendLogAddIntentsHandledByBootstrap(
                    normalizedUserId,
                    explicitAddIntentUserIds
                );
            }
            return result;
        }
    );

    const result = bootstrapResult as Record<string, any>;
    const snapshot = result.snapshot as Record<string, any> | null | undefined;
    const detail = String(result.detail || snapshot?.detail || '');

    if (result.stale || !snapshot) {
        if (isCurrentBootstrapTarget(normalizedUserId, endpoint)) {
            throw new Error(
                `Friend roster baseline was stale for ${normalizedUserId}.`
            );
        }

        return {
            userId: normalizedUserId,
            count: result.count ?? 0,
            detail,
            stale: true
        };
    }

    if (!isCurrentBootstrapTarget(normalizedUserId, endpoint)) {
        return {
            userId: normalizedUserId,
            count: result.count ?? 0,
            detail,
            stale: true
        };
    }

    useFriendRosterStore.getState().setRosterSnapshot({
        currentUserId: normalizedUserId,
        friendsById: snapshot.friendsById || {},
        orderedFriendIds: snapshot.orderedFriendIds || [],
        onlineIds: snapshot.onlineIds || [],
        activeIds: snapshot.activeIds || [],
        offlineIds: snapshot.offlineIds || [],
        detail
    });
    recordFriendRosterFacts({
        endpoint,
        friendsById: snapshot.friendsById || {}
    });
    useSessionStore.getState().setFriendsLoaded(true);
    syncStartupServicesTask([detail]);

    return {
        userId: normalizedUserId,
        count: result.count ?? 0,
        detail,
        stale: false
    };
}

export function bootstrapFriendRoster(options: any) {
    const normalizedUserId = normalizeUserId(
        options?.userId || options?.currentUserSnapshot?.id
    );
    const currentUserSnapshot =
        options?.currentUserSnapshot &&
        typeof options.currentUserSnapshot === 'object'
            ? options.currentUserSnapshot
            : null;
    const preserveLoadedState = Boolean(options?.preserveLoadedState);
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
        .catch((error: any) => {
            if (isCurrentBootstrapTarget(normalizedUserId, options?.endpoint)) {
                useFriendRosterStore
                    .getState()
                    .setRosterError(
                        error instanceof Error ? error.message : String(error)
                    );
                if (!preserveLoadedState) {
                    useSessionStore.getState().setFriendsLoaded(false);
                }
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
