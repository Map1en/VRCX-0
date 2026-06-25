import {
    commands,
    type SocialFriendRosterBaselineOutput
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import friendLogRepository from '@/repositories/friendLogRepository';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    buildCurrentEntryFromFriend,
    buildFriendStateMap,
    buildSeedRosterFriendsById,
    getDisplayName,
    hasCompleteFriendStateSnapshot,
    hasFriendListSnapshot,
    isRecord,
    normalizeFriendsById,
    normalizeStringArray,
    normalizeUserId,
    type FriendBootstrapOptions,
    type FriendBootstrapResult,
    type FriendBootstrapSnapshot,
    type FriendLogRow,
    type FriendRecord
} from './friendBootstrapModel';
import {
    enqueueFriendLogMutation,
    getExplicitFriendLogAddIntentUserIds,
    markExplicitFriendLogAddIntentsHandledByBootstrap,
    signalFriendLogChanged
} from './friendLogMutationService';
import { syncStartupServicesTask } from './startupServicesStatus';
import { notifyRuntimeVrchatAuthFailure } from './vrchatAuthErrorService';

const activeBootstraps = new Map<string, Promise<FriendBootstrapResult>>();

function getFriendLogInitKey(userId: string) {
    return `friendLogInit_${userId}`;
}

async function seedFriendRosterFromCurrentUserSnapshot({
    normalizedUserId,
    endpoint,
    websocket,
    currentUserSnapshot,
    detail
}: {
    normalizedUserId: string;
    endpoint: string;
    websocket: string;
    currentUserSnapshot: unknown;
    detail: string;
}) {
    if (!hasCompleteFriendStateSnapshot(currentUserSnapshot)) {
        return false;
    }

    const stateById = buildFriendStateMap(currentUserSnapshot);
    let friendLogRows: FriendLogRow[] = [];
    try {
        friendLogRows =
            await friendLogRepository.getFriendLogCurrent(normalizedUserId);
    } catch (error) {
        console.warn('Failed to seed friend roster from friend log:', error);
    }

    if (!isCurrentBootstrapTarget(normalizedUserId, endpoint, websocket)) {
        return false;
    }

    useFriendRosterStore.getState().setRosterSeedSnapshot({
        currentUserId: normalizedUserId,
        friendsById: buildSeedRosterFriendsById(stateById, friendLogRows),
        detail
    });
    return true;
}

async function runFriendLogStartupReconciliation({
    normalizedUserId,
    endpoint,
    websocket,
    currentUserSnapshot,
    fastFriendsById
}: {
    normalizedUserId: string;
    endpoint: string;
    websocket: string;
    currentUserSnapshot: unknown;
    fastFriendsById: Record<string, FriendRecord>;
}) {
    if (!hasFriendListSnapshot(currentUserSnapshot)) {
        return;
    }

    await enqueueFriendLogMutation(normalizedUserId, async () => {
        const initialized = await configRepository.getBool(
            getFriendLogInitKey(normalizedUserId),
            false
        );
        if (initialized) {
            return;
        }
        if (!isCurrentBootstrapTarget(normalizedUserId, endpoint, websocket)) {
            return;
        }

        const currentFriendIds = currentUserSnapshot.friends
            .map(normalizeUserId)
            .filter(Boolean);
        const currentFriendIdSet = new Set(currentFriendIds);
        const explicitAddIntentUserIds = new Set(
            getExplicitFriendLogAddIntentUserIds(normalizedUserId)
        );

        const entries = currentFriendIds
            .filter((friendId) => friendId !== normalizedUserId)
            .map((friendId, index) =>
                buildCurrentEntryFromFriend({
                    userId: friendId,
                    friend: fastFriendsById[friendId] || { id: friendId },
                    friendNumber: index + 1
                })
            );
        if (!isCurrentBootstrapTarget(normalizedUserId, endpoint, websocket)) {
            return;
        }
        await friendLogRepository.replaceFriendLogCurrent(
            normalizedUserId,
            entries,
            { historyEntries: [], addedHistoryEntries: [] }
        );
        for (const friendId of explicitAddIntentUserIds) {
            if (currentFriendIdSet.has(friendId)) {
                markExplicitFriendLogAddIntentsHandledByBootstrap(
                    normalizedUserId,
                    [friendId]
                );
            }
        }
        if (!isCurrentBootstrapTarget(normalizedUserId, endpoint, websocket)) {
            return;
        }
        await configRepository.setBool(
            getFriendLogInitKey(normalizedUserId),
            true
        );
    });
}

function startFriendRosterBackgroundTasks({
    normalizedUserId,
    endpoint,
    websocket,
    currentUserSnapshot,
    fastFriendsById
}: {
    normalizedUserId: string;
    endpoint: string;
    websocket: string;
    currentUserSnapshot: unknown;
    fastFriendsById: Record<string, FriendRecord>;
}) {
    void runFriendLogStartupReconciliation({
        normalizedUserId,
        endpoint,
        websocket,
        currentUserSnapshot,
        fastFriendsById
    }).catch((error) => {
        console.warn('Friend log startup reconciliation failed:', error);
    });
}

function bootstrapTargetKey(
    userId: unknown,
    endpoint: unknown = '',
    websocket: unknown = ''
) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedEndpoint = String(endpoint || '');
    const normalizedWebsocket = String(websocket || '');
    return `${normalizedUserId}\u0000${normalizedEndpoint}\u0000${normalizedWebsocket}`;
}

function isCurrentBootstrapTarget(
    userId: unknown,
    endpoint: unknown = '',
    websocket: unknown = null
) {
    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();
    const expectedWebsocket =
        websocket === null ? null : String(websocket || '');

    return (
        runtimeState.auth.currentUserId === userId &&
        runtimeState.auth.currentUserEndpoint === String(endpoint || '') &&
        (expectedWebsocket === null ||
            runtimeState.auth.currentUserWebsocket === expectedWebsocket) &&
        sessionState.isLoggedIn &&
        sessionState.sessionPhase === 'ready'
    );
}

async function runFriendBootstrap({
    userId,
    endpoint = '',
    websocket = null,
    currentUserSnapshot,
    preserveLoadedState = false
}: FriendBootstrapOptions): Promise<FriendBootstrapResult> {
    const currentSnapshot = isRecord(currentUserSnapshot)
        ? currentUserSnapshot
        : null;
    const normalizedUserId = normalizeUserId(userId || currentSnapshot?.id);
    if (!normalizedUserId) {
        throw new Error('Friend bootstrap requires an authenticated user id.');
    }
    const normalizedEndpoint = String(endpoint || '');
    const realtimeWebsocket = String(
        websocket ?? useRuntimeStore.getState().auth.currentUserWebsocket ?? ''
    );

    const displayName = getDisplayName(currentSnapshot) || normalizedUserId;

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
            endpoint: normalizedEndpoint,
            websocket: realtimeWebsocket,
            currentUserSnapshot: currentSnapshot,
            detail: `Loading the full friend roster baseline for ${displayName}.`
        });
    }

    const result: SocialFriendRosterBaselineOutput = await commands
        .appSocialFriendRosterBaselineGet({
            userId: normalizedUserId,
            endpoint: normalizedEndpoint,
            websocket: realtimeWebsocket,
            currentUserSnapshot: currentSnapshot,
            isFirstLoad: !preserveLoadedState
        })
        .catch((error: unknown) => {
            notifyRuntimeVrchatAuthFailure(
                error,
                normalizedEndpoint,
                'friend roster baseline'
            );
            throw error;
        });

    const snapshot: FriendBootstrapSnapshot | null = isRecord(result.snapshot)
        ? result.snapshot
        : null;
    const detail = String(result.detail || snapshot?.detail || '');

    if (result.stale || !snapshot) {
        if (
            isCurrentBootstrapTarget(
                normalizedUserId,
                normalizedEndpoint,
                realtimeWebsocket
            )
        ) {
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

    if (
        !isCurrentBootstrapTarget(
            normalizedUserId,
            normalizedEndpoint,
            realtimeWebsocket
        )
    ) {
        return {
            userId: normalizedUserId,
            count: result.count ?? 0,
            detail,
            stale: true
        };
    }

    const friendsById = normalizeFriendsById(snapshot.friendsById);

    useFriendRosterStore.getState().setRosterSnapshot({
        currentUserId: normalizedUserId,
        friendsById,
        orderedFriendIds: normalizeStringArray(snapshot.orderedFriendIds),
        onlineIds: normalizeStringArray(snapshot.onlineIds),
        activeIds: normalizeStringArray(snapshot.activeIds),
        offlineIds: normalizeStringArray(snapshot.offlineIds),
        detail
    });
    useSessionStore.getState().setFriendsLoaded(true);
    syncStartupServicesTask([detail]);
    if (result.friendLogChanged) {
        signalFriendLogChanged();
    }
    if (!preserveLoadedState) {
        startFriendRosterBackgroundTasks({
            normalizedUserId,
            endpoint: normalizedEndpoint,
            websocket: realtimeWebsocket,
            currentUserSnapshot: currentSnapshot,
            fastFriendsById: friendsById
        });
    }

    return {
        userId: normalizedUserId,
        count: result.count ?? 0,
        detail,
        stale: false
    };
}

export function bootstrapFriendRoster(
    options: FriendBootstrapOptions
): Promise<FriendBootstrapResult> {
    const normalizedUserId = normalizeUserId(
        options?.userId ||
            (isRecord(options?.currentUserSnapshot)
                ? options.currentUserSnapshot.id
                : '')
    );
    const currentUserSnapshot = isRecord(options?.currentUserSnapshot)
        ? options.currentUserSnapshot
        : null;
    const preserveLoadedState = Boolean(options?.preserveLoadedState);
    if (!normalizedUserId || !currentUserSnapshot) {
        return Promise.reject(
            new Error('Friend bootstrap requires an authenticated user id.')
        );
    }

    const activeKey = bootstrapTargetKey(
        normalizedUserId,
        options?.endpoint,
        options?.websocket ??
            useRuntimeStore.getState().auth.currentUserWebsocket
    );
    if (activeBootstraps.has(activeKey)) {
        return activeBootstraps.get(activeKey)!;
    }

    const promise = runFriendBootstrap({
        ...options,
        userId: normalizedUserId,
        currentUserSnapshot,
        preserveLoadedState
    })
        .catch((error: unknown) => {
            if (
                isCurrentBootstrapTarget(
                    normalizedUserId,
                    options?.endpoint,
                    options?.websocket ??
                        useRuntimeStore.getState().auth.currentUserWebsocket
                )
            ) {
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
