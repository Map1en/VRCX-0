import activityPersistenceRepository from '@/repositories/activityPersistenceRepository';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { syncStartupServicesTask } from './startupServicesStatus';

type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
type ActivityStatePatch = Parameters<RuntimeState['setActivityState']>[0];
type ActivitySyncState = NonNullable<
    Awaited<
        ReturnType<typeof activityPersistenceRepository.getActivitySyncState>
    >
>;
type ActivitySession = Awaited<
    ReturnType<typeof activityPersistenceRepository.getActivitySessions>
>[number];
type ActivityRefreshResult = Awaited<
    ReturnType<typeof activityPersistenceRepository.refreshSelfActivitySessions>
>;
type ActivitySourceBounds = Awaited<
    ReturnType<typeof activityPersistenceRepository.getSelfActivitySourceBounds>
>;
type CurrentUserSnapshot = Record<string, unknown> & {
    id?: unknown;
    displayName?: unknown;
    username?: unknown;
};
type ActivityWarmupOptions = {
    userId?: unknown;
    currentUserSnapshot?: unknown;
};
type ActivityWarmupResult = {
    userId: string;
    stale: boolean;
    cachedRangeDays?: number;
    sessionCount?: number;
};

type ActivitySnapshot = {
    userId: string;
    sync: ActivitySyncState;
    sessions: ActivitySession[];
};

const snapshotMap = new Map<string, ActivitySnapshot>();
const activeWarmups = new Map<string, Promise<ActivityWarmupResult>>();
const FULL_CACHE_BATCH_DAYS = 30;
const FULL_CACHE_MAX_DAYS = 3650;
const INITIAL_RANGE_DAYS = 90;

function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function getDisplayName(user: CurrentUserSnapshot | null | undefined) {
    return (
        normalizeUserId(user?.displayName) ||
        normalizeUserId(user?.username) ||
        normalizeUserId(user?.id)
    );
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

    return snapshotMap.get(normalizedUserId)!;
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

function updateActivityState(patch: ActivityStatePatch) {
    useRuntimeStore.getState().setActivityState(patch);
}

function yieldToEventLoop() {
    return new Promise((resolve) => {
        window.setTimeout(resolve, 0);
    });
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

async function hydrateSnapshot(userId: string) {
    const snapshot = getSnapshot(userId);
    if (snapshot.sync.updatedAt || snapshot.sessions.length > 0) {
        return snapshot;
    }

    const [syncState, sessions] = await Promise.all([
        activityPersistenceRepository.getActivitySyncState(userId),
        activityPersistenceRepository.getActivitySessions(userId)
    ]);

    if (syncState) {
        snapshot.sync = {
            ...snapshot.sync,
            ...syncState,
            userId: normalizeUserId(syncState.userId),
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
    result: ActivityRefreshResult
) {
    if (Array.isArray(result?.sessions)) {
        snapshot.sessions = result.sessions as ActivitySession[];
    }
    if (result?.sync && typeof result.sync === 'object') {
        snapshot.sync = {
            ...snapshot.sync,
            ...result.sync,
            userId: normalizeUserId(result.sync.userId || snapshot.userId),
            isSelf: true
        };
    }
}

async function fullRefresh(snapshot: ActivitySnapshot, rangeDays: number) {
    const result =
        await activityPersistenceRepository.refreshSelfActivitySessions({
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

    const result =
        await activityPersistenceRepository.refreshSelfActivitySessions({
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

    const result =
        await activityPersistenceRepository.refreshSelfActivitySessions({
            userId: snapshot.userId,
            mode: 'expand',
            rangeDays
        });
    applyActivityRefreshResult(snapshot, result);
}

async function runActivityCacheWarmup({
    userId,
    currentUserSnapshot
}: ActivityWarmupOptions): Promise<ActivityWarmupResult> {
    const currentSnapshot = isRecord(currentUserSnapshot)
        ? (currentUserSnapshot as CurrentUserSnapshot)
        : null;
    const normalizedUserId = normalizeUserId(userId || currentSnapshot?.id);
    if (!normalizedUserId) {
        throw new Error(
            'Activity cache warm-up requires an authenticated user id.'
        );
    }

    const displayName = getDisplayName(currentSnapshot) || normalizedUserId;
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

    await yieldToEventLoop();
    if (!isCurrentWarmupTarget(normalizedUserId)) {
        return {
            userId: normalizedUserId,
            stale: true
        };
    }

    const currentDays = snapshot.sync.cachedRangeDays || INITIAL_RANGE_DAYS;
    const sourceBounds: ActivitySourceBounds =
        await activityPersistenceRepository.getSelfActivitySourceBounds();

    if (!isCurrentWarmupTarget(normalizedUserId)) {
        return {
            userId: normalizedUserId,
            stale: true
        };
    }

    if (!sourceBounds.count || !sourceBounds.firstCreatedAt) {
        setWarmupReady(snapshot, displayName);
        return {
            userId: normalizedUserId,
            stale: false,
            cachedRangeDays: snapshot.sync.cachedRangeDays || 0,
            sessionCount: snapshot.sessions.length
        };
    }

    const earliestDate = new Date(sourceBounds.firstCreatedAt);
    const totalDays = Math.max(
        Number.isNaN(earliestDate.getTime())
            ? currentDays
            : Math.ceil((Date.now() - earliestDate.getTime()) / 86400000) + 1,
        currentDays
    );
    const cappedTotalDays = Math.min(FULL_CACHE_MAX_DAYS, totalDays);

    let targetDays = currentDays;
    while (targetDays < cappedTotalDays) {
        if (!isCurrentWarmupTarget(normalizedUserId)) {
            return {
                userId: normalizedUserId,
                stale: true
            };
        }

        targetDays = Math.min(
            targetDays + FULL_CACHE_BATCH_DAYS,
            cappedTotalDays
        );
        const nextTarget = targetDays;

        await expandRange(snapshot, nextTarget);

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

        if (targetDays < cappedTotalDays) {
            await yieldToEventLoop();
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

export function bootstrapActivityCache(
    options: ActivityWarmupOptions = {}
): Promise<ActivityWarmupResult> {
    const normalizedUserId = normalizeUserId(
        options?.userId ||
            (isRecord(options?.currentUserSnapshot)
                ? options.currentUserSnapshot.id
                : '')
    );
    const currentUserSnapshot = isRecord(options?.currentUserSnapshot)
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
        return activeWarmups.get(normalizedUserId)!;
    }

    const promise = runActivityCacheWarmup({
        userId: normalizedUserId,
        currentUserSnapshot
    })
        .catch((error: unknown) => {
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
