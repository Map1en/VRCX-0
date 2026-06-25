import activityPersistenceRepository from '@/repositories/activityPersistenceRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import type { ActivitySession } from '@/shared/utils/activityEngine';
import { mergeSessions } from '@/shared/utils/activityEngine';
import { runActivityWorkerTask } from '@/workers/activityWorkerRunner';

interface NormalizeConfig {
    floorPercentile: number;
    capPercentile: number;
    rankWeight: number;
    targetCoverage: number;
    targetVolume: number;
}

type ActivitySnapshot = {
    userId: any;
    isSelf: any;
    sync: {
        userId: any;
        updatedAt: string;
        isSelf: any;
        sourceLastCreatedAt: string;
        pendingSessionStartAt: string | null;
        cachedRangeDays: number;
        ownerUserId: string;
    };
    sessions: ActivitySession[];
    activityViews: Map<string, ActivityViewCache>;
    overlapViews: Map<string, ActivityViewCache>;
};

type ActivitySessionSnapshotResult = {
    pendingSessionStartAt: number | null;
    sessions: ActivitySession[];
};

type ActivityViewCache = Record<string, unknown> & {
    builtAt?: unknown;
    builtFromCursor?: unknown;
    filteredEventCount?: unknown;
    normalizedBuckets: unknown[];
    peakDay?: unknown;
    peakTime?: unknown;
    rawBuckets: unknown[];
};

const snapshotMap = new Map();
const inFlightJobs = new Map();
const FULL_CACHE_MAX_DAYS = 3650;
const MAX_SNAPSHOT_ENTRIES = 12;
let deferredWriteQueue = Promise.resolve();

function recordOrEmpty(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? { ...value } : {};
}

function activitySessionSnapshotResult(
    value: unknown
): ActivitySessionSnapshotResult {
    const result = recordOrEmpty(value);
    const pendingSessionStartAt = Number(result.pendingSessionStartAt);
    return {
        pendingSessionStartAt: Number.isFinite(pendingSessionStartAt)
            ? pendingSessionStartAt
            : null,
        sessions: Array.isArray(result.sessions) ? result.sessions : []
    };
}

function activityViewCache(value: unknown): ActivityViewCache {
    const result = recordOrEmpty(value);
    return {
        ...result,
        rawBuckets: Array.isArray(result.rawBuckets) ? result.rawBuckets : [],
        normalizedBuckets: Array.isArray(result.normalizedBuckets)
            ? result.normalizedBuckets
            : []
    };
}

function deferWrite(task: any) {
    const run = () => {
        deferredWriteQueue = deferredWriteQueue
            .catch(() => {})
            .then(task)
            .catch((error: any) => {
                console.error('[Activity] deferred write failed:', error);
            });
        return deferredWriteQueue;
    };
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run);
        return;
    }
    setTimeout(run, 0);
}

function snapshotKey(userId: any, isSelf: any, ownerUserId: any = '') {
    return `${String(ownerUserId || '').trim()}:${isSelf ? 'self' : 'friend'}:${String(userId || '').trim()}`;
}

function createSnapshot(userId: any, isSelf: any): ActivitySnapshot {
    return {
        userId,
        isSelf,
        sync: {
            userId,
            updatedAt: '',
            isSelf,
            sourceLastCreatedAt: '',
            pendingSessionStartAt: null,
            cachedRangeDays: 0,
            ownerUserId: ''
        },
        sessions: [],
        activityViews: new Map(),
        overlapViews: new Map()
    };
}

function getSnapshot(userId: any, isSelf: any, ownerUserId: any = '') {
    const normalizedUserId = String(userId || '').trim();
    const key = snapshotKey(normalizedUserId, isSelf, ownerUserId);
    let snapshot = snapshotMap.get(key);
    if (!snapshot) {
        snapshot = createSnapshot(normalizedUserId, isSelf);
        snapshotMap.set(key, snapshot);
    } else if (typeof isSelf === 'boolean') {
        snapshot.isSelf = isSelf;
        snapshot.sync.isSelf = isSelf;
    }
    snapshot.sync.ownerUserId = String(ownerUserId || '').trim();
    touchSnapshot(key, snapshot);
    pruneSnapshots();
    return snapshot;
}

function touchSnapshot(key: any, snapshot: any) {
    snapshotMap.delete(key);
    snapshotMap.set(key, snapshot);
}

function isSnapshotInFlight(key: any) {
    const [ownerUserId, role, userId] = key.split(':');
    const isSelf = role === 'self';
    const jobPrefix = `${ownerUserId || ''}:${userId || ''}:${isSelf}:`;
    for (const jobKey of inFlightJobs.keys()) {
        if (jobKey.startsWith(jobPrefix)) {
            return true;
        }
    }
    return false;
}

function pruneSnapshots() {
    if (snapshotMap.size <= MAX_SNAPSHOT_ENTRIES) {
        return;
    }

    for (const [key] of snapshotMap) {
        if (isSnapshotInFlight(key)) {
            continue;
        }
        snapshotMap.delete(key);
        if (snapshotMap.size <= MAX_SNAPSHOT_ENTRIES) {
            break;
        }
    }
}

function clearDerivedViews(snapshot: any) {
    snapshot.activityViews.clear();
    snapshot.overlapViews.clear();
}

function overlapExcludeKey(excludeHours: any) {
    if (!excludeHours?.enabled) {
        return '';
    }
    return `${excludeHours.startHour}-${excludeHours.endHour}`;
}

function pairCursor(leftCursor: any, rightCursor: any) {
    return `${leftCursor || ''}|${rightCursor || ''}`;
}

async function hydrateSnapshot(
    userId: any,
    isSelf: any,
    ownerUserId: any = ''
) {
    const snapshot = getSnapshot(userId, isSelf, ownerUserId);
    if (snapshot.sync.updatedAt || snapshot.sessions.length > 0) {
        return snapshot;
    }

    if (!isSelf) {
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
            isSelf:
                typeof syncState.isSelf === 'boolean'
                    ? syncState.isSelf
                    : snapshot.isSelf
        };
    }
    if (Array.isArray(sessions) && sessions.length > 0) {
        snapshot.sessions = sessions;
    }
    return snapshot;
}

async function fullRefresh(snapshot: any, rangeDays: any) {
    if (snapshot.isSelf) {
        const result =
            await activityPersistenceRepository.refreshSelfActivitySessions({
                userId: snapshot.userId,
                mode: 'full',
                rangeDays,
                nowMs: Date.now()
            });
        applySelfRefreshResult(snapshot, result);
        clearDerivedViews(snapshot);
        return;
    }

    const sourceItems =
        await activityPersistenceRepository.getActivitySourceSlice({
            userId: snapshot.userId,
            ownerUserId: snapshot.sync.ownerUserId || '',
            isSelf: snapshot.isSelf,
            fromDays: rangeDays
        });
    const sourceLastCreatedAt = sourceItems.length
        ? sourceItems[sourceItems.length - 1].created_at
        : '';
    const result = activitySessionSnapshotResult(
        await runActivityWorkerTask('computeSessionsSnapshot', {
            sourceType: 'friend_presence',
            events: sourceItems,
            initialStart: null,
            nowMs: Date.now(),
            mayHaveOpenTail: false,
            sourceRevision: sourceLastCreatedAt
        })
    );

    snapshot.sessions = result.sessions;
    snapshot.sync = {
        ...snapshot.sync,
        updatedAt: new Date().toISOString(),
        isSelf: snapshot.isSelf,
        sourceLastCreatedAt,
        pendingSessionStartAt: result.pendingSessionStartAt,
        cachedRangeDays: rangeDays
    };
    clearDerivedViews(snapshot);

    if (snapshot.isSelf) {
        await activityPersistenceRepository.replaceActivitySessions(
            snapshot.userId,
            snapshot.sessions
        );
        await activityPersistenceRepository.upsertActivitySyncState(
            snapshot.sync
        );
    }
}

async function incrementalRefresh(snapshot: any) {
    if (!snapshot.sync.sourceLastCreatedAt) {
        return;
    }

    if (snapshot.isSelf) {
        const result =
            await activityPersistenceRepository.refreshSelfActivitySessions({
                userId: snapshot.userId,
                mode: 'incremental',
                nowMs: Date.now()
            });
        const previousCursor = snapshot.sync.sourceLastCreatedAt;
        applySelfRefreshResult(snapshot, result);
        if (
            result.sourceCount > 0 ||
            snapshot.sync.sourceLastCreatedAt !== previousCursor
        ) {
            clearDerivedViews(snapshot);
        }
        return;
    }

    const sourceItems =
        await activityPersistenceRepository.getActivitySourceAfter({
            userId: snapshot.userId,
            ownerUserId: snapshot.sync.ownerUserId || '',
            isSelf: snapshot.isSelf,
            afterCreatedAt: snapshot.sync.sourceLastCreatedAt,
            inclusive: snapshot.isSelf
        });
    if (sourceItems.length === 0) {
        snapshot.sync.updatedAt = new Date().toISOString();
        if (snapshot.isSelf) {
            await activityPersistenceRepository.upsertActivitySyncState(
                snapshot.sync
            );
        }
        return;
    }

    const sourceLastCreatedAt = sourceItems[sourceItems.length - 1].created_at;
    const result = activitySessionSnapshotResult(
        await runActivityWorkerTask('computeSessionsSnapshot', {
            sourceType: 'friend_presence',
            events: sourceItems,
            initialStart: snapshot.sync.pendingSessionStartAt,
            nowMs: Date.now(),
            mayHaveOpenTail: false,
            sourceRevision: sourceLastCreatedAt
        })
    );

    const replaceFromStartAt = snapshot.sessions.length
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
    clearDerivedViews(snapshot);

    if (snapshot.isSelf) {
        await activityPersistenceRepository.appendActivitySessions({
            userId: snapshot.userId,
            sessions:
                replaceFromStartAt === null
                    ? mergedSessions
                    : mergedSessions.filter(
                          (session: any) => session.start >= replaceFromStartAt
                      ),
            replaceFromStartAt
        });
        await activityPersistenceRepository.upsertActivitySyncState(
            snapshot.sync
        );
    }
}

async function expandRange(snapshot: any, rangeDays: any) {
    const currentDays = snapshot.sync.cachedRangeDays || 0;
    if (rangeDays <= currentDays) {
        return;
    }

    if (snapshot.isSelf) {
        const result =
            await activityPersistenceRepository.refreshSelfActivitySessions({
                userId: snapshot.userId,
                mode: 'expand',
                rangeDays,
                nowMs: Date.now()
            });
        applySelfRefreshResult(snapshot, result);
        clearDerivedViews(snapshot);
        return;
    }

    const sourceItems =
        await activityPersistenceRepository.getActivitySourceSlice({
            userId: snapshot.userId,
            ownerUserId: snapshot.sync.ownerUserId || '',
            isSelf: snapshot.isSelf,
            fromDays: rangeDays,
            toDays: currentDays
        });
    const result = activitySessionSnapshotResult(
        await runActivityWorkerTask('computeSessionsSnapshot', {
            sourceType: 'friend_presence',
            events: sourceItems,
            initialStart: null,
            nowMs: Date.now(),
            mayHaveOpenTail: false,
            sourceRevision: snapshot.sync.sourceLastCreatedAt
        })
    );

    if (result.sessions.length > 0) {
        snapshot.sessions = mergeSessions(result.sessions, snapshot.sessions);
        if (snapshot.isSelf) {
            await activityPersistenceRepository.replaceActivitySessions(
                snapshot.userId,
                snapshot.sessions
            );
        }
    }
    snapshot.sync.cachedRangeDays = rangeDays;
    snapshot.sync.updatedAt = new Date().toISOString();
    clearDerivedViews(snapshot);
    if (snapshot.isSelf) {
        await activityPersistenceRepository.upsertActivitySyncState(
            snapshot.sync
        );
    }
}

function applySelfRefreshResult(snapshot: any, result: any) {
    snapshot.sessions = Array.isArray(result?.sessions) ? result.sessions : [];
    snapshot.sync = {
        ...snapshot.sync,
        ...(result?.sync || {}),
        isSelf: true,
        ownerUserId: snapshot.sync.ownerUserId || ''
    };
}

async function ensureSnapshot(
    userId: any,
    { isSelf, rangeDays, forceRefresh = false, ownerUserId = '' }: any
) {
    const jobKey = `${ownerUserId}:${userId}:${isSelf}:${rangeDays}:${forceRefresh ? 'force' : 'normal'}`;
    const existingJob = inFlightJobs.get(jobKey);
    if (existingJob) {
        return existingJob;
    }

    const job = (async () => {
        const snapshot = await hydrateSnapshot(userId, isSelf, ownerUserId);
        if (
            forceRefresh ||
            !snapshot.sync.updatedAt ||
            !snapshot.sync.sourceLastCreatedAt
        ) {
            await fullRefresh(snapshot, rangeDays);
        } else {
            await incrementalRefresh(snapshot);
            if (rangeDays > snapshot.sync.cachedRangeDays) {
                await expandRange(snapshot, rangeDays);
            }
        }
        return snapshot;
    })().finally(() => {
        inFlightJobs.delete(jobKey);
    });

    inFlightJobs.set(jobKey, job);
    return job;
}

export function pickActivityNormalizeConfig(isSelf: any, rangeDays: any) {
    const common: any = {
        7: {
            floorPercentile: 10,
            capPercentile: 80,
            rankWeight: 0.15,
            targetCoverage: 0.12,
            targetVolume: 40
        },
        30: {
            floorPercentile: 15,
            capPercentile: 85,
            rankWeight: 0.2,
            targetCoverage: 0.25,
            targetVolume: 60
        },
        90: {
            floorPercentile: 15,
            capPercentile: 85,
            rankWeight: 0.2,
            targetCoverage: 0.3,
            targetVolume: 50
        }
    };
    return (
        common[rangeDays] || {
            floorPercentile: 15,
            capPercentile: 85,
            rankWeight: 0.2,
            targetCoverage: isSelf ? 0.25 : 0.2,
            targetVolume: isSelf ? 60 : 35
        }
    );
}

export function pickOverlapNormalizeConfig(rangeDays: any) {
    const byRange: Record<number, NormalizeConfig> = {
        7: {
            floorPercentile: 10,
            capPercentile: 80,
            rankWeight: 0.15,
            targetCoverage: 0.08,
            targetVolume: 15
        },
        30: {
            floorPercentile: 15,
            capPercentile: 85,
            rankWeight: 0.2,
            targetCoverage: 0.15,
            targetVolume: 25
        },
        90: {
            floorPercentile: 15,
            capPercentile: 85,
            rankWeight: 0.2,
            targetCoverage: 0.18,
            targetVolume: 20
        }
    };
    return (
        byRange[rangeDays] || {
            floorPercentile: 15,
            capPercentile: 85,
            rankWeight: 0.2,
            targetCoverage: 0.15,
            targetVolume: 25
        }
    );
}

async function getCache(
    userId: any,
    isSelf: any = false,
    ownerUserId: any = ''
) {
    const snapshot = await hydrateSnapshot(userId, isSelf, ownerUserId);
    return {
        userId: snapshot.userId,
        isSelf: snapshot.isSelf,
        updatedAt: snapshot.sync.updatedAt,
        sourceLastCreatedAt: snapshot.sync.sourceLastCreatedAt,
        pendingSessionStartAt: snapshot.sync.pendingSessionStartAt,
        cachedRangeDays: snapshot.sync.cachedRangeDays,
        sessions: snapshot.sessions
    };
}

async function loadActivityView({
    userId,
    ownerUserId = '',
    isSelf = false,
    rangeDays = 30,
    dayLabels,
    forceRefresh = false
}: any) {
    const snapshot = await ensureSnapshot(userId, {
        isSelf,
        rangeDays,
        forceRefresh,
        ownerUserId
    });
    const cacheOwnerUserId = ownerUserId || userId;
    const cacheTargetUserId = isSelf ? '' : userId;
    const cacheKey = String(rangeDays);
    const currentCursor = snapshot.sync.sourceLastCreatedAt || '';
    let view = snapshot.activityViews.get(cacheKey);

    if (!forceRefresh && view?.builtFromCursor === currentCursor) {
        return {
            hasAnyData: snapshot.sessions.length > 0,
            filteredEventCount: view.filteredEventCount,
            peakDay: view.peakDay,
            peakTime: view.peakTime,
            rawBuckets: view.rawBuckets,
            normalizedBuckets: view.normalizedBuckets
        };
    }

    if (!forceRefresh && cacheOwnerUserId) {
        const persisted =
            await activityPersistenceRepository.getActivityBucketCache({
                ownerUserId: cacheOwnerUserId,
                targetUserId: cacheTargetUserId,
                rangeDays,
                viewKind:
                    activityPersistenceRepository.ACTIVITY_VIEW_KIND.ACTIVITY
            });
        if (persisted && persisted.builtFromCursor === currentCursor) {
            view = activityViewCache({
                ...recordOrEmpty(persisted.summary),
                rawBuckets: persisted.rawBuckets,
                normalizedBuckets: persisted.normalizedBuckets,
                builtFromCursor: persisted.builtFromCursor,
                builtAt: persisted.builtAt
            });
            snapshot.activityViews.set(cacheKey, view);
            return {
                hasAnyData: snapshot.sessions.length > 0,
                filteredEventCount: view.filteredEventCount,
                peakDay: view.peakDay,
                peakTime: view.peakTime,
                rawBuckets: view.rawBuckets,
                normalizedBuckets: view.normalizedBuckets
            };
        }
    }

    view = {
        ...activityViewCache(
            await runActivityWorkerTask('computeActivityView', {
                sessions: snapshot.sessions,
                dayLabels,
                rangeDays,
                normalizeConfig: pickActivityNormalizeConfig(isSelf, rangeDays)
            })
        ),
        builtFromCursor: currentCursor,
        builtAt: new Date().toISOString()
    };
    snapshot.activityViews.set(cacheKey, view);
    if (cacheOwnerUserId) {
        deferWrite(() =>
            activityPersistenceRepository.upsertActivityBucketCache({
                ownerUserId: cacheOwnerUserId,
                targetUserId: cacheTargetUserId,
                rangeDays,
                viewKind:
                    activityPersistenceRepository.ACTIVITY_VIEW_KIND.ACTIVITY,
                builtFromCursor: currentCursor,
                rawBuckets: view.rawBuckets,
                normalizedBuckets: view.normalizedBuckets,
                summary: {
                    peakDay: view.peakDay,
                    peakTime: view.peakTime,
                    filteredEventCount: view.filteredEventCount
                },
                builtAt: view.builtAt
            })
        );
    }

    return {
        hasAnyData: snapshot.sessions.length > 0,
        filteredEventCount: view.filteredEventCount,
        peakDay: view.peakDay,
        peakTime: view.peakTime,
        rawBuckets: view.rawBuckets,
        normalizedBuckets: view.normalizedBuckets
    };
}

async function loadOverlapView({
    currentUserId,
    targetUserId,
    ownerUserId = currentUserId,
    rangeDays = 30,
    dayLabels,
    excludeHours,
    forceRefresh = false
}: any) {
    const [selfSnapshot, targetSnapshot] = await Promise.all([
        ensureSnapshot(currentUserId, {
            isSelf: true,
            rangeDays,
            forceRefresh,
            ownerUserId
        }),
        ensureSnapshot(targetUserId, {
            isSelf: false,
            rangeDays,
            forceRefresh,
            ownerUserId
        })
    ]);
    const excludeKey = overlapExcludeKey(excludeHours);
    const cacheKey = `${targetUserId}:${rangeDays}:${excludeKey}`;
    const cursor = pairCursor(
        selfSnapshot.sync.sourceLastCreatedAt,
        targetSnapshot.sync.sourceLastCreatedAt
    );
    let view = targetSnapshot.overlapViews.get(cacheKey);

    if (!forceRefresh && view?.builtFromCursor === cursor) {
        return {
            hasOverlapData: view.rawBuckets.some((value: any) => value > 0),
            overlapPercent: view.overlapPercent,
            bestOverlapTime: view.bestOverlapTime,
            rawBuckets: view.rawBuckets,
            normalizedBuckets: view.normalizedBuckets
        };
    }

    if (!forceRefresh && ownerUserId) {
        const persisted =
            await activityPersistenceRepository.getActivityBucketCache({
                ownerUserId,
                targetUserId,
                rangeDays,
                viewKind:
                    activityPersistenceRepository.ACTIVITY_VIEW_KIND.OVERLAP,
                excludeKey
            });
        if (persisted?.builtFromCursor === cursor) {
            view = activityViewCache({
                ...recordOrEmpty(persisted.summary),
                rawBuckets: persisted.rawBuckets,
                normalizedBuckets: persisted.normalizedBuckets,
                builtFromCursor: persisted.builtFromCursor,
                builtAt: persisted.builtAt
            });
            targetSnapshot.overlapViews.set(cacheKey, view);
            return {
                hasOverlapData: view.rawBuckets.some((value: any) => value > 0),
                overlapPercent: view.overlapPercent,
                bestOverlapTime: view.bestOverlapTime,
                rawBuckets: view.rawBuckets,
                normalizedBuckets: view.normalizedBuckets
            };
        }
    }

    view = {
        ...activityViewCache(
            await runActivityWorkerTask('computeOverlapView', {
                selfSessions: selfSnapshot.sessions,
                targetSessions: targetSnapshot.sessions,
                dayLabels,
                rangeDays,
                excludeHours: excludeHours?.enabled ? excludeHours : null,
                normalizeConfig: pickOverlapNormalizeConfig(rangeDays)
            })
        ),
        builtFromCursor: cursor,
        builtAt: new Date().toISOString()
    };
    targetSnapshot.overlapViews.set(cacheKey, view);
    if (ownerUserId) {
        deferWrite(() =>
            activityPersistenceRepository.upsertActivityBucketCache({
                ownerUserId,
                targetUserId,
                rangeDays,
                viewKind:
                    activityPersistenceRepository.ACTIVITY_VIEW_KIND.OVERLAP,
                excludeKey,
                builtFromCursor: cursor,
                rawBuckets: view.rawBuckets,
                normalizedBuckets: view.normalizedBuckets,
                summary: {
                    overlapPercent: view.overlapPercent,
                    bestOverlapTime: view.bestOverlapTime
                },
                builtAt: view.builtAt
            })
        );
    }

    return {
        hasOverlapData: view.rawBuckets.some((value: any) => value > 0),
        overlapPercent: view.overlapPercent,
        bestOverlapTime: view.bestOverlapTime,
        rawBuckets: view.rawBuckets,
        normalizedBuckets: view.normalizedBuckets
    };
}

async function loadTopWorldsView({
    rangeDays = 30,
    limit = 5,
    sortBy = 'time',
    excludeWorldId = ''
}: any) {
    return gameLogRepository.getMyTopWorlds(
        rangeDays,
        limit,
        sortBy,
        excludeWorldId
    );
}

function invalidateUser(userId: any, ownerUserId: any = '') {
    const normalizedUserId = String(userId || '').trim();
    const normalizedOwnerUserId = String(ownerUserId || '').trim();
    for (const key of snapshotMap.keys()) {
        if (
            key.endsWith(`:${normalizedUserId}`) &&
            (!normalizedOwnerUserId ||
                key.startsWith(`${normalizedOwnerUserId}:`))
        ) {
            snapshotMap.delete(key);
        }
    }
}

const userActivityViewService: any = {
    FULL_CACHE_MAX_DAYS,
    getCache,
    invalidateUser,
    loadActivityView,
    loadOverlapView,
    loadTopWorldsView
};

export { userActivityViewService };
