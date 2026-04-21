import {
    activityRepository,
    gameLogRepository
} from '@/repositories/index.js';
import { mergeSessions } from '@/shared/utils/activityEngine.js';
import { runActivityWorkerTask } from '@/workers/activityWorkerRunner.js';

const snapshotMap = new Map();
const inFlightJobs = new Map();
const FULL_CACHE_MAX_DAYS = 3650;
const MAX_SNAPSHOT_ENTRIES = 12;
let deferredWriteQueue = Promise.resolve();

function deferWrite(task) {
    const run = () => {
        deferredWriteQueue = deferredWriteQueue
            .catch(() => {})
            .then(task)
            .catch((error) => {
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

function snapshotKey(userId, isSelf, ownerUserId = '') {
    return `${String(ownerUserId || '').trim()}:${isSelf ? 'self' : 'friend'}:${String(userId || '').trim()}`;
}

function createSnapshot(userId, isSelf) {
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

function getSnapshot(userId, isSelf, ownerUserId = '') {
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

function touchSnapshot(key, snapshot) {
    snapshotMap.delete(key);
    snapshotMap.set(key, snapshot);
}

function isSnapshotInFlight(key) {
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

function clearDerivedViews(snapshot) {
    snapshot.activityViews.clear();
    snapshot.overlapViews.clear();
}

function overlapExcludeKey(excludeHours) {
    if (!excludeHours?.enabled) {
        return '';
    }
    return `${excludeHours.startHour}-${excludeHours.endHour}`;
}

function pairCursor(leftCursor, rightCursor) {
    return `${leftCursor || ''}|${rightCursor || ''}`;
}

async function hydrateSnapshot(userId, isSelf, ownerUserId = '') {
    const snapshot = getSnapshot(userId, isSelf, ownerUserId);
    if (snapshot.sync.updatedAt || snapshot.sessions.length > 0) {
        return snapshot;
    }

    if (!isSelf) {
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

async function fullRefresh(snapshot, rangeDays) {
    const sourceItems = await activityRepository.getActivitySourceSlice({
        userId: snapshot.userId,
        ownerUserId: snapshot.sync.ownerUserId || '',
        isSelf: snapshot.isSelf,
        fromDays: rangeDays
    });
    const sourceLastCreatedAt = sourceItems.length
        ? sourceItems[sourceItems.length - 1].created_at
        : '';
    const result = await runActivityWorkerTask('computeSessionsSnapshot', {
        sourceType: snapshot.isSelf ? 'self_gamelog' : 'friend_presence',
        rows: snapshot.isSelf ? sourceItems : undefined,
        events: snapshot.isSelf ? undefined : sourceItems,
        initialStart: null,
        nowMs: Date.now(),
        mayHaveOpenTail: snapshot.isSelf,
        sourceRevision: sourceLastCreatedAt
    });

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
        await activityRepository.replaceActivitySessions(
            snapshot.userId,
            snapshot.sessions
        );
        await activityRepository.upsertActivitySyncState(snapshot.sync);
    }
}

async function incrementalRefresh(snapshot) {
    if (!snapshot.sync.sourceLastCreatedAt) {
        return;
    }

    const sourceItems = await activityRepository.getActivitySourceAfter({
        userId: snapshot.userId,
        ownerUserId: snapshot.sync.ownerUserId || '',
        isSelf: snapshot.isSelf,
        afterCreatedAt: snapshot.sync.sourceLastCreatedAt,
        inclusive: snapshot.isSelf
    });
    if (sourceItems.length === 0) {
        snapshot.sync.updatedAt = new Date().toISOString();
        if (snapshot.isSelf) {
            await activityRepository.upsertActivitySyncState(snapshot.sync);
        }
        return;
    }

    const sourceLastCreatedAt = sourceItems[sourceItems.length - 1].created_at;
    const result = await runActivityWorkerTask('computeSessionsSnapshot', {
        sourceType: snapshot.isSelf ? 'self_gamelog' : 'friend_presence',
        rows: snapshot.isSelf ? sourceItems : undefined,
        events: snapshot.isSelf ? undefined : sourceItems,
        initialStart: snapshot.isSelf
            ? null
            : snapshot.sync.pendingSessionStartAt,
        nowMs: Date.now(),
        mayHaveOpenTail: snapshot.isSelf,
        sourceRevision: sourceLastCreatedAt
    });

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
        await activityRepository.appendActivitySessions({
            userId: snapshot.userId,
            sessions:
                replaceFromStartAt === null
                    ? mergedSessions
                    : mergedSessions.filter(
                          (session) => session.start >= replaceFromStartAt
                      ),
            replaceFromStartAt
        });
        await activityRepository.upsertActivitySyncState(snapshot.sync);
    }
}

async function expandRange(snapshot, rangeDays) {
    const currentDays = snapshot.sync.cachedRangeDays || 0;
    if (rangeDays <= currentDays) {
        return;
    }

    const sourceItems = await activityRepository.getActivitySourceSlice({
        userId: snapshot.userId,
        ownerUserId: snapshot.sync.ownerUserId || '',
        isSelf: snapshot.isSelf,
        fromDays: rangeDays,
        toDays: currentDays
    });
    const result = await runActivityWorkerTask('computeSessionsSnapshot', {
        sourceType: snapshot.isSelf ? 'self_gamelog' : 'friend_presence',
        rows: snapshot.isSelf ? sourceItems : undefined,
        events: snapshot.isSelf ? undefined : sourceItems,
        initialStart: null,
        nowMs: Date.now(),
        mayHaveOpenTail: false,
        sourceRevision: snapshot.sync.sourceLastCreatedAt
    });

    if (result.sessions.length > 0) {
        snapshot.sessions = mergeSessions(result.sessions, snapshot.sessions);
        if (snapshot.isSelf) {
            await activityRepository.replaceActivitySessions(
                snapshot.userId,
                snapshot.sessions
            );
        }
    }
    snapshot.sync.cachedRangeDays = rangeDays;
    snapshot.sync.updatedAt = new Date().toISOString();
    clearDerivedViews(snapshot);
    if (snapshot.isSelf) {
        await activityRepository.upsertActivitySyncState(snapshot.sync);
    }
}

async function ensureSnapshot(
    userId,
    { isSelf, rangeDays, forceRefresh = false, ownerUserId = '' }
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

function pickActivityNormalizeConfig(isSelf, rangeDays) {
    const common = {
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

function pickOverlapNormalizeConfig(rangeDays) {
    return (
        {
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
        }[rangeDays] || {
            floorPercentile: 15,
            capPercentile: 85,
            rankWeight: 0.2,
            targetCoverage: 0.15,
            targetVolume: 25
        }
    );
}

async function getCache(userId, isSelf = false, ownerUserId = '') {
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
}) {
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
        const persisted = await activityRepository.getActivityBucketCache({
            ownerUserId: cacheOwnerUserId,
            targetUserId: cacheTargetUserId,
            rangeDays,
            viewKind: activityRepository.ACTIVITY_VIEW_KIND.ACTIVITY
        });
        if (persisted?.builtFromCursor === currentCursor) {
            view = {
                ...persisted.summary,
                rawBuckets: persisted.rawBuckets,
                normalizedBuckets: persisted.normalizedBuckets,
                builtFromCursor: persisted.builtFromCursor,
                builtAt: persisted.builtAt
            };
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

    const computed = await runActivityWorkerTask('computeActivityView', {
        sessions: snapshot.sessions,
        dayLabels,
        rangeDays,
        normalizeConfig: pickActivityNormalizeConfig(isSelf, rangeDays)
    });
    view = {
        ...computed,
        builtFromCursor: currentCursor,
        builtAt: new Date().toISOString()
    };
    snapshot.activityViews.set(cacheKey, view);
    if (cacheOwnerUserId) {
        deferWrite(() =>
            activityRepository.upsertActivityBucketCache({
                ownerUserId: cacheOwnerUserId,
                targetUserId: cacheTargetUserId,
                rangeDays,
                viewKind: activityRepository.ACTIVITY_VIEW_KIND.ACTIVITY,
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
}) {
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
            hasOverlapData: view.rawBuckets.some((value) => value > 0),
            overlapPercent: view.overlapPercent,
            bestOverlapTime: view.bestOverlapTime,
            rawBuckets: view.rawBuckets,
            normalizedBuckets: view.normalizedBuckets
        };
    }

    if (!forceRefresh && ownerUserId) {
        const persisted = await activityRepository.getActivityBucketCache({
            ownerUserId,
            targetUserId,
            rangeDays,
            viewKind: activityRepository.ACTIVITY_VIEW_KIND.OVERLAP,
            excludeKey
        });
        if (persisted?.builtFromCursor === cursor) {
            view = {
                ...persisted.summary,
                rawBuckets: persisted.rawBuckets,
                normalizedBuckets: persisted.normalizedBuckets,
                builtFromCursor: persisted.builtFromCursor,
                builtAt: persisted.builtAt
            };
            targetSnapshot.overlapViews.set(cacheKey, view);
            return {
                hasOverlapData: view.rawBuckets.some((value) => value > 0),
                overlapPercent: view.overlapPercent,
                bestOverlapTime: view.bestOverlapTime,
                rawBuckets: view.rawBuckets,
                normalizedBuckets: view.normalizedBuckets
            };
        }
    }

    view = await runActivityWorkerTask('computeOverlapView', {
        selfSessions: selfSnapshot.sessions,
        targetSessions: targetSnapshot.sessions,
        dayLabels,
        rangeDays,
        excludeHours: excludeHours?.enabled ? excludeHours : null,
        normalizeConfig: pickOverlapNormalizeConfig(rangeDays)
    });
    view = {
        ...view,
        builtFromCursor: cursor,
        builtAt: new Date().toISOString()
    };
    targetSnapshot.overlapViews.set(cacheKey, view);
    if (ownerUserId) {
        deferWrite(() =>
            activityRepository.upsertActivityBucketCache({
                ownerUserId,
                targetUserId,
                rangeDays,
                viewKind: activityRepository.ACTIVITY_VIEW_KIND.OVERLAP,
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
        hasOverlapData: view.rawBuckets.some((value) => value > 0),
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
}) {
    return gameLogRepository.getMyTopWorlds(
        rangeDays,
        limit,
        sortBy,
        excludeWorldId
    );
}

function invalidateUser(userId, ownerUserId = '') {
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

const userActivityViewService = {
    FULL_CACHE_MAX_DAYS,
    getCache,
    invalidateUser,
    loadActivityView,
    loadOverlapView,
    loadTopWorldsView
};

export { userActivityViewService };
