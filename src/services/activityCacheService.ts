import { activityRepository } from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { syncStartupServicesTask } from './startupServicesStatus.js';

type ActivitySourceRow = Record<string, any> & {
    created_at: string | number | Date;
};

type ActivitySession = Record<string, any> & {
    start: any;
    end: any;
};

type ActivitySnapshot = {
    userId: string;
    sync: Record<string, any> & {
        userId: string;
        updatedAt: string;
        isSelf: boolean;
        sourceLastCreatedAt: string;
        pendingSessionStartAt: any;
        cachedRangeDays: number;
    };
    sessions: ActivitySession[];
};

const snapshotMap = new Map<string, ActivitySnapshot>();
const activeWarmups = new Map<string, Promise<unknown>>();
const FULL_CACHE_BATCH_DAYS = 30;
const FULL_CACHE_MAX_DAYS = 3650;
const INITIAL_RANGE_DAYS = 90;

function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getDisplayName(user: Record<string, any> | null | undefined) {
    return user?.displayName || user?.username || user?.id || '';
}

function createSnapshot(userId: string): ActivitySnapshot {
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

function getSnapshot(userId: unknown) {
    const normalizedUserId = normalizeUserId(userId);
    if (!snapshotMap.has(normalizedUserId)) {
        snapshotMap.set(normalizedUserId, createSnapshot(normalizedUserId));
    }

    return snapshotMap.get(normalizedUserId);
}

function clearSnapshot(userId: unknown) {
    const normalizedUserId = normalizeUserId(userId);
    if (normalizedUserId) {
        snapshotMap.delete(normalizedUserId);
        return;
    }

    snapshotMap.clear();
}

function isCurrentWarmupTarget(userId: unknown) {
    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();

    return (
        runtimeState.auth.currentUserId === userId &&
        sessionState.isLoggedIn &&
        sessionState.sessionPhase === 'ready'
    );
}

function updateActivityState(patch: Record<string, any>) {
    useRuntimeStore.getState().setActivityState(patch);
}

function updateWarmupProgress(snapshot: ActivitySnapshot, detail: string) {
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

function setWarmupReady(snapshot: ActivitySnapshot, displayName: string) {
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

function setWarmupError(userId: string, error: unknown) {
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

function scheduleIdleTask(task: () => unknown) {
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

async function hydrateSnapshot(userId: string) {
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
            ...(syncState as Record<string, any>),
            userId: normalizeUserId((syncState as Record<string, any>).userId),
            isSelf: true
        };
    }

    if (Array.isArray(sessions) && sessions.length > 0) {
        snapshot.sessions = sessions;
    }

    return snapshot;
}

function applyActivityRefreshResult(
    snapshot: ActivitySnapshot,
    result: Record<string, any>
) {
    if (Array.isArray(result?.sessions)) {
        snapshot.sessions = result.sessions as ActivitySession[];
    }
    if (result?.sync && typeof result.sync === 'object') {
        snapshot.sync = {
            ...snapshot.sync,
            ...(result.sync as Record<string, any>),
            userId: normalizeUserId(result.sync.userId || snapshot.userId),
            isSelf: true
        };
    }
}

async function fullRefresh(snapshot: ActivitySnapshot, rangeDays: number) {
    const result = await activityRepository.refreshSelfActivitySessions({
        userId: snapshot.userId,
        mode: 'full',
        rangeDays
    });
    applyActivityRefreshResult(snapshot, result);
}

async function incrementalRefresh(snapshot: ActivitySnapshot) {
    if (!snapshot.sync.sourceLastCreatedAt) {
        return;
    }

    const result = await activityRepository.refreshSelfActivitySessions({
        userId: snapshot.userId,
        mode: 'incremental'
    });
    applyActivityRefreshResult(snapshot, result);
}

async function expandRange(snapshot: ActivitySnapshot, rangeDays: number) {
    const currentDays = snapshot.sync.cachedRangeDays || 0;
    if (rangeDays <= currentDays) {
        return;
    }

    const result = await activityRepository.refreshSelfActivitySessions({
        userId: snapshot.userId,
        mode: 'expand',
        rangeDays
    });
    applyActivityRefreshResult(snapshot, result);
}

async function runActivityCacheWarmup({
    userId,
    currentUserSnapshot
}: {
    userId?: unknown;
    currentUserSnapshot?: Record<string, any> | null;
}) {
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
    const probeItems = (await activityRepository.getSelfActivitySourceSlice({
        userId: normalizedUserId,
        fromDays: FULL_CACHE_MAX_DAYS,
        toDays: currentDays
    } as any)) as ActivitySourceRow[];

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

export function bootstrapActivityCache(options: Record<string, any> = {}) {
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

export function resetActivityCacheState(userId: unknown = null) {
    clearSnapshot(userId);
    useRuntimeStore.getState().resetActivityState();
}
