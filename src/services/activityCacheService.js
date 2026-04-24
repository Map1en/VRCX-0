import { activityRepository } from '@/repositories/index.js';
import { mergeSessions } from '@/shared/utils/activityEngine.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { runActivityWorkerTask } from '@/workers/activityWorkerRunner.js';

import { syncStartupServicesTask } from './startupServicesStatus.js';

const snapshotMap = new Map();
const activeWarmups = new Map();
const FULL_CACHE_BATCH_DAYS = 30;
const FULL_CACHE_MAX_DAYS = 3650;
const INITIAL_RANGE_DAYS = 90;

function normalizeUserId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getDisplayName(user) {
    return user?.displayName || user?.username || user?.id || '';
}

function createSnapshot(userId) {
    return {
        userId,
        sync: {
            userId,
            updatedAt: '',
            isSelf: true,
            sourceLastCreatedAt: '',
            pendingSessionStartAt: null,
            cachedRangeDays: 0
        },
        sessions: []
    };
}

function getSnapshot(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!snapshotMap.has(normalizedUserId)) {
        snapshotMap.set(normalizedUserId, createSnapshot(normalizedUserId));
    }

    return snapshotMap.get(normalizedUserId);
}

function clearSnapshot(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (normalizedUserId) {
        snapshotMap.delete(normalizedUserId);
        return;
    }

    snapshotMap.clear();
}

function isCurrentWarmupTarget(userId) {
    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();

    return (
        runtimeState.auth.currentUserId === userId &&
        sessionState.isLoggedIn &&
        sessionState.sessionPhase === 'ready'
    );
}

function updateActivityState(patch) {
    useRuntimeStore.getState().setActivityState(patch);
}

function updateWarmupProgress(snapshot, detail) {
    if (!isCurrentWarmupTarget(snapshot.userId)) {
        return false;
    }

    updateActivityState({
        currentUserId: snapshot.userId,
        status: 'running',
        detail,
        cachedRangeDays: snapshot.sync.cachedRangeDays || 0,
        sessionCount: snapshot.sessions.length,
        fullCacheReady: false
    });
    syncStartupServicesTask([detail]);
    return true;
}

function setWarmupReady(snapshot, displayName) {
    if (!isCurrentWarmupTarget(snapshot.userId)) {
        return false;
    }

    const detail = `Activity cache warm-up is ready for ${displayName} (${snapshot.sync.cachedRangeDays || 0} cached day(s), ${snapshot.sessions.length} sessions).`;
    updateActivityState({
        currentUserId: snapshot.userId,
        status: 'ready',
        detail,
        cachedRangeDays: snapshot.sync.cachedRangeDays || 0,
        sessionCount: snapshot.sessions.length,
        fullCacheReady: true
    });
    syncStartupServicesTask([detail]);
    return true;
}

function setWarmupError(userId, error) {
    if (!isCurrentWarmupTarget(userId)) {
        return;
    }

    const message = error instanceof Error ? error.message : String(error);
    updateActivityState({
        currentUserId: userId,
        status: 'error',
        detail: message,
        fullCacheReady: false
    });
    useRuntimeStore
        .getState()
        .setStartupTask(
            'services',
            'error',
            `Activity cache warm-up failed: ${message}`
        );
}

function scheduleIdleTask(task) {
    return new Promise((resolve, reject) => {
        const callback = () => {
            Promise.resolve().then(task).then(resolve).catch(reject);
        };

        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(callback);
            return;
        }

        window.setTimeout(callback, 0);
    });
}

async function hydrateSnapshot(userId) {
    const snapshot = getSnapshot(userId);
    if (snapshot.sync.updatedAt || snapshot.sessions.length > 0) {
        return snapshot;
    }

    const [syncState, sessions] = await Promise.all([
        activityRepository.getActivitySyncState(userId),
        activityRepository.getActivitySessions(userId)
    ]);

    if (syncState) {
        snapshot.sync = {
            ...snapshot.sync,
            ...syncState,
            isSelf: true
        };
    }

    if (Array.isArray(sessions) && sessions.length > 0) {
        snapshot.sessions = sessions;
    }

    return snapshot;
}

async function fullRefresh(snapshot, rangeDays) {
    const sourceItems = await activityRepository.getSelfActivitySourceSlice({
        userId: snapshot.userId,
        fromDays: rangeDays
    });
    const sourceLastCreatedAt =
        sourceItems.length > 0
            ? sourceItems[sourceItems.length - 1].created_at
            : '';
    const result = await runActivityWorkerTask('computeSessionsSnapshot', {
        sourceType: 'self_gamelog',
        rows: sourceItems,
        initialStart: null,
        nowMs: Date.now(),
        mayHaveOpenTail: true,
        sourceRevision: sourceLastCreatedAt
    });

    snapshot.sessions = result.sessions;
    snapshot.sync = {
        ...snapshot.sync,
        updatedAt: new Date().toISOString(),
        isSelf: true,
        sourceLastCreatedAt,
        pendingSessionStartAt: result.pendingSessionStartAt,
        cachedRangeDays: rangeDays
    };

    await activityRepository.replaceActivitySessions(
        snapshot.userId,
        snapshot.sessions
    );
    await activityRepository.upsertActivitySyncState(snapshot.sync);
}

async function incrementalRefresh(snapshot) {
    if (!snapshot.sync.sourceLastCreatedAt) {
        return;
    }

    const sourceItems = await activityRepository.getSelfActivitySourceAfter({
        userId: snapshot.userId,
        afterCreatedAt: snapshot.sync.sourceLastCreatedAt,
        inclusive: true
    });

    if (sourceItems.length === 0) {
        snapshot.sync.updatedAt = new Date().toISOString();
        await activityRepository.upsertActivitySyncState(snapshot.sync);
        return;
    }

    const sourceLastCreatedAt = sourceItems[sourceItems.length - 1].created_at;
    const result = await runActivityWorkerTask('computeSessionsSnapshot', {
        sourceType: 'self_gamelog',
        rows: sourceItems,
        initialStart: null,
        nowMs: Date.now(),
        mayHaveOpenTail: true,
        sourceRevision: sourceLastCreatedAt
    });

    const replaceFromStartAt =
        snapshot.sessions.length > 0
            ? snapshot.sessions[Math.max(snapshot.sessions.length - 1, 0)].start
            : null;
    const mergedSessions = mergeSessions(snapshot.sessions, result.sessions);

    snapshot.sessions = mergedSessions;
    snapshot.sync = {
        ...snapshot.sync,
        updatedAt: new Date().toISOString(),
        sourceLastCreatedAt,
        pendingSessionStartAt: result.pendingSessionStartAt
    };

    const tailSessions =
        replaceFromStartAt === null
            ? mergedSessions
            : mergedSessions.filter(
                  (session) => session.start >= replaceFromStartAt
              );

    await activityRepository.appendActivitySessions({
        userId: snapshot.userId,
        sessions: tailSessions,
        replaceFromStartAt
    });
    await activityRepository.upsertActivitySyncState(snapshot.sync);
}

async function expandRange(snapshot, rangeDays) {
    const currentDays = snapshot.sync.cachedRangeDays || 0;
    if (rangeDays <= currentDays) {
        return;
    }

    const sourceItems = await activityRepository.getSelfActivitySourceSlice({
        userId: snapshot.userId,
        fromDays: rangeDays,
        toDays: currentDays
    });
    const result = await runActivityWorkerTask('computeSessionsSnapshot', {
        sourceType: 'self_gamelog',
        rows: sourceItems,
        initialStart: null,
        nowMs: Date.now(),
        mayHaveOpenTail: false,
        sourceRevision: snapshot.sync.sourceLastCreatedAt
    });

    if (result.sessions.length > 0) {
        snapshot.sessions = mergeSessions(result.sessions, snapshot.sessions);
        await activityRepository.replaceActivitySessions(
            snapshot.userId,
            snapshot.sessions
        );
    }

    snapshot.sync.cachedRangeDays = rangeDays;
    snapshot.sync.updatedAt = new Date().toISOString();
    await activityRepository.upsertActivitySyncState(snapshot.sync);
}

async function runActivityCacheWarmup({ userId, currentUserSnapshot }) {
    const normalizedUserId = normalizeUserId(userId || currentUserSnapshot?.id);
    if (!normalizedUserId) {
        throw new Error(
            'Activity cache warm-up requires an authenticated user id.'
        );
    }

    const displayName = getDisplayName(currentUserSnapshot) || normalizedUserId;
    const snapshot = await hydrateSnapshot(normalizedUserId);

    updateWarmupProgress(
        snapshot,
        `Activity cache warm-up started for ${displayName} (${snapshot.sync.cachedRangeDays || 0} cached day(s)).`
    );

    if (!isCurrentWarmupTarget(normalizedUserId)) {
        return {
            userId: normalizedUserId,
            stale: true
        };
    }

    if (!snapshot.sync.updatedAt || (snapshot.sync.cachedRangeDays || 0) <= 0) {
        await fullRefresh(snapshot, INITIAL_RANGE_DAYS);
        if (
            !updateWarmupProgress(
                snapshot,
                `Activity cache baseline built for ${displayName} (${snapshot.sync.cachedRangeDays || 0} cached day(s)).`
            )
        ) {
            return {
                userId: normalizedUserId,
                stale: true
            };
        }
    } else {
        await incrementalRefresh(snapshot);
        if (
            !updateWarmupProgress(
                snapshot,
                `Activity cache snapshot refreshed for ${displayName} (${snapshot.sync.cachedRangeDays || 0} cached day(s)).`
            )
        ) {
            return {
                userId: normalizedUserId,
                stale: true
            };
        }
    }

    const currentDays = snapshot.sync.cachedRangeDays || INITIAL_RANGE_DAYS;
    const probeItems = await activityRepository.getSelfActivitySourceSlice({
        userId: normalizedUserId,
        fromDays: FULL_CACHE_MAX_DAYS,
        toDays: currentDays
    });

    if (!isCurrentWarmupTarget(normalizedUserId)) {
        return {
            userId: normalizedUserId,
            stale: true
        };
    }

    if (probeItems.length === 0) {
        setWarmupReady(snapshot, displayName);
        return {
            userId: normalizedUserId,
            stale: false,
            cachedRangeDays: snapshot.sync.cachedRangeDays || 0,
            sessionCount: snapshot.sessions.length
        };
    }

    const earliestDate = new Date(probeItems[0].created_at);
    const totalDays = Math.max(
        Math.ceil((Date.now() - earliestDate.getTime()) / 86400000),
        currentDays
    );

    let targetDays = currentDays;
    while (targetDays < totalDays) {
        if (!isCurrentWarmupTarget(normalizedUserId)) {
            return {
                userId: normalizedUserId,
                stale: true
            };
        }

        targetDays = Math.min(targetDays + FULL_CACHE_BATCH_DAYS, totalDays);
        const nextTarget = targetDays;

        await scheduleIdleTask(async () => {
            await expandRange(snapshot, nextTarget);
        });

        if (
            !updateWarmupProgress(
                snapshot,
                `Activity cache warm-up expanded to ${snapshot.sync.cachedRangeDays || nextTarget} day(s) for ${displayName}.`
            )
        ) {
            return {
                userId: normalizedUserId,
                stale: true
            };
        }
    }

    setWarmupReady(snapshot, displayName);
    return {
        userId: normalizedUserId,
        stale: false,
        cachedRangeDays: snapshot.sync.cachedRangeDays || 0,
        sessionCount: snapshot.sessions.length
    };
}

export function bootstrapActivityCache(options) {
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
            new Error(
                'Activity cache warm-up requires an authenticated user snapshot.'
            )
        );
    }

    if (activeWarmups.has(normalizedUserId)) {
        return activeWarmups.get(normalizedUserId);
    }

    const promise = runActivityCacheWarmup({
        userId: normalizedUserId,
        currentUserSnapshot
    })
        .catch((error) => {
            setWarmupError(normalizedUserId, error);
            throw error;
        })
        .finally(() => {
            activeWarmups.delete(normalizedUserId);
        });

    activeWarmups.set(normalizedUserId, promise);
    return promise;
}

export function resetActivityCacheState(userId = null) {
    clearSnapshot(userId);
    useRuntimeStore.getState().resetActivityState();
}
