import { database } from '@/services/database/index.js';
import { mergeSessions } from '@/shared/utils/activityEngine.js';
import { runActivityWorkerTask } from '@/workers/activityWorkerRunner.js';

const snapshotMap = new Map();
const inFlightJobs = new Map();
const FULL_CACHE_MAX_DAYS = 3650;

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
            cachedRangeDays: 0
        },
        sessions: []
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
    return snapshot;
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
        database.getActivitySyncStateV2(userId),
        database.getActivitySessionsV2(userId)
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
    const sourceItems = await database.getActivitySourceSliceV2({
        userId: snapshot.userId,
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

    if (snapshot.isSelf) {
        await database.replaceActivitySessionsV2(snapshot.userId, snapshot.sessions);
        await database.upsertActivitySyncStateV2(snapshot.sync);
    }
}

async function incrementalRefresh(snapshot) {
    if (!snapshot.sync.sourceLastCreatedAt) {
        return;
    }

    const sourceItems = await database.getActivitySourceAfterV2({
        userId: snapshot.userId,
        isSelf: snapshot.isSelf,
        afterCreatedAt: snapshot.sync.sourceLastCreatedAt,
        inclusive: snapshot.isSelf
    });
    if (sourceItems.length === 0) {
        snapshot.sync.updatedAt = new Date().toISOString();
        if (snapshot.isSelf) {
            await database.upsertActivitySyncStateV2(snapshot.sync);
        }
        return;
    }

    const sourceLastCreatedAt = sourceItems[sourceItems.length - 1].created_at;
    const result = await runActivityWorkerTask('computeSessionsSnapshot', {
        sourceType: snapshot.isSelf ? 'self_gamelog' : 'friend_presence',
        rows: snapshot.isSelf ? sourceItems : undefined,
        events: snapshot.isSelf ? undefined : sourceItems,
        initialStart: snapshot.isSelf ? null : snapshot.sync.pendingSessionStartAt,
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

    if (snapshot.isSelf) {
        await database.appendActivitySessionsV2({
            userId: snapshot.userId,
            sessions: replaceFromStartAt === null
                ? mergedSessions
                : mergedSessions.filter((session) => session.start >= replaceFromStartAt),
            replaceFromStartAt
        });
        await database.upsertActivitySyncStateV2(snapshot.sync);
    }
}

async function expandRange(snapshot, rangeDays) {
    const currentDays = snapshot.sync.cachedRangeDays || 0;
    if (rangeDays <= currentDays) {
        return;
    }

    const sourceItems = await database.getActivitySourceSliceV2({
        userId: snapshot.userId,
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
            await database.replaceActivitySessionsV2(snapshot.userId, snapshot.sessions);
        }
    }
    snapshot.sync.cachedRangeDays = rangeDays;
    snapshot.sync.updatedAt = new Date().toISOString();
    if (snapshot.isSelf) {
        await database.upsertActivitySyncStateV2(snapshot.sync);
    }
}

async function ensureSnapshot(userId, { isSelf, rangeDays, forceRefresh = false, ownerUserId = '' }) {
    const jobKey = `${ownerUserId}:${userId}:${isSelf}:${rangeDays}:${forceRefresh ? 'force' : 'normal'}`;
    const existingJob = inFlightJobs.get(jobKey);
    if (existingJob) {
        return existingJob;
    }

    const job = (async () => {
        const snapshot = await hydrateSnapshot(userId, isSelf, ownerUserId);
        if (forceRefresh || !snapshot.sync.updatedAt || !snapshot.sync.sourceLastCreatedAt) {
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
        7: { floorPercentile: 10, capPercentile: 80, rankWeight: 0.15, targetCoverage: 0.12, targetVolume: 40 },
        30: { floorPercentile: 15, capPercentile: 85, rankWeight: 0.2, targetCoverage: 0.25, targetVolume: 60 },
        90: { floorPercentile: 15, capPercentile: 85, rankWeight: 0.2, targetCoverage: 0.3, targetVolume: 50 }
    };
    return common[rangeDays] || {
        floorPercentile: 15,
        capPercentile: 85,
        rankWeight: 0.2,
        targetCoverage: isSelf ? 0.25 : 0.2,
        targetVolume: isSelf ? 60 : 35
    };
}

function pickOverlapNormalizeConfig(rangeDays) {
    return ({
        7: { floorPercentile: 10, capPercentile: 80, rankWeight: 0.15, targetCoverage: 0.08, targetVolume: 15 },
        30: { floorPercentile: 15, capPercentile: 85, rankWeight: 0.2, targetCoverage: 0.15, targetVolume: 25 },
        90: { floorPercentile: 15, capPercentile: 85, rankWeight: 0.2, targetCoverage: 0.18, targetVolume: 20 }
    })[rangeDays] || {
        floorPercentile: 15,
        capPercentile: 85,
        rankWeight: 0.2,
        targetCoverage: 0.15,
        targetVolume: 25
    };
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

async function loadActivityView({ userId, ownerUserId = '', isSelf = false, rangeDays = 30, dayLabels, forceRefresh = false }) {
    const snapshot = await ensureSnapshot(userId, { isSelf, rangeDays, forceRefresh, ownerUserId });
    const view = await runActivityWorkerTask('computeActivityView', {
        sessions: snapshot.sessions,
        dayLabels,
        rangeDays,
        normalizeConfig: pickActivityNormalizeConfig(isSelf, rangeDays)
    });

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
        ensureSnapshot(currentUserId, { isSelf: true, rangeDays, forceRefresh, ownerUserId }),
        ensureSnapshot(targetUserId, { isSelf: false, rangeDays, forceRefresh, ownerUserId })
    ]);
    const view = await runActivityWorkerTask('computeOverlapView', {
        selfSessions: selfSnapshot.sessions,
        targetSessions: targetSnapshot.sessions,
        dayLabels,
        rangeDays,
        excludeHours: excludeHours?.enabled ? excludeHours : null,
        normalizeConfig: pickOverlapNormalizeConfig(rangeDays)
    });

    return {
        hasOverlapData: view.rawBuckets.some((value) => value > 0),
        overlapPercent: view.overlapPercent,
        bestOverlapTime: view.bestOverlapTime,
        rawBuckets: view.rawBuckets,
        normalizedBuckets: view.normalizedBuckets
    };
}

async function loadTopWorldsView({ rangeDays = 30, limit = 5, sortBy = 'time', excludeWorldId = '' }) {
    return database.getMyTopWorlds(rangeDays, limit, sortBy, excludeWorldId);
}

function invalidateUser(userId, ownerUserId = '') {
    const normalizedUserId = String(userId || '').trim();
    const normalizedOwnerUserId = String(ownerUserId || '').trim();
    for (const key of snapshotMap.keys()) {
        if (
            key.endsWith(`:${normalizedUserId}`) &&
            (!normalizedOwnerUserId || key.startsWith(`${normalizedOwnerUserId}:`))
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
