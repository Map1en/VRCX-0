import { backend } from '@/platform/index.js';
import type { ActivitySession } from '@/shared/utils/activityEngine.js';

type ActivityViewKind =
    (typeof ACTIVITY_VIEW_KIND)[keyof typeof ACTIVITY_VIEW_KIND];
type ObjectRow = Record<string, unknown>;

interface ActivitySyncStateRow extends ObjectRow {
    user_id?: unknown;
    userId?: unknown;
    updated_at?: unknown;
    updatedAt?: unknown;
    is_self?: unknown;
    isSelf?: unknown;
    source_last_created_at?: unknown;
    sourceLastCreatedAt?: unknown;
    pending_session_start_at?: unknown;
    pendingSessionStartAt?: unknown;
    cached_range_days?: unknown;
    cachedRangeDays?: unknown;
}

interface ActivitySessionRow extends ObjectRow {
    start_at?: unknown;
    start?: unknown;
    end_at?: unknown;
    end?: unknown;
    is_open_tail?: unknown;
    isOpenTail?: unknown;
    source_revision?: unknown;
    sourceRevision?: unknown;
}

interface ActivityLocationRow extends ObjectRow {
    created_at?: unknown;
    createdAt?: unknown;
    time?: unknown;
}

interface PresenceRow extends ObjectRow {
    created_at?: unknown;
    type?: unknown;
}

interface ActivitySyncStateInput {
    userId?: unknown;
    updatedAt?: string;
    isSelf?: unknown;
    sourceLastCreatedAt?: string;
    pendingSessionStartAt?: string | number | null;
    cachedRangeDays?: string | number;
}

interface AppendActivitySessionsInput {
    userId?: unknown;
    sessions?: ActivitySession[];
    replaceFromStartAt?: number | null;
}

interface ActivityBucketCacheRow extends ObjectRow {
    user_id?: unknown;
    target_user_id?: unknown;
    range_days?: unknown;
    view_kind?: unknown;
    exclude_key?: unknown;
    bucket_version?: unknown;
    built_from_cursor?: unknown;
    raw_buckets_json?: unknown;
    normalized_buckets_json?: unknown;
    summary_json?: unknown;
    built_at?: unknown;
}

interface ActivityBucketCacheQuery {
    ownerUserId: string;
    targetUserId?: string;
    rangeDays: number;
    viewKind: ActivityViewKind | string;
    excludeKey?: string;
}

interface ActivityBucketCacheInput extends ActivityBucketCacheQuery {
    bucketVersion?: number;
    builtFromCursor?: string;
    rawBuckets?: unknown[];
    normalizedBuckets?: unknown[];
    summary?: unknown;
    builtAt?: string;
}

interface ActivitySelfSessionsRefreshInput {
    userId?: unknown;
    mode: 'full' | 'incremental' | 'expand';
    rangeDays?: string | number;
    nowMs?: number;
}

interface ActivitySelfSessionsRefreshOutput extends ObjectRow {
    sync?: ActivitySyncStateRow | null;
    sessions?: Array<ActivitySessionRow | unknown[]>;
    sourceCount?: unknown;
    source_count?: unknown;
}

const ACTIVITY_VIEW_KIND = Object.freeze({
    ACTIVITY: 'activity',
    OVERLAP: 'overlap'
});

function normalizeActivitySyncStateRow(
    row: ActivitySyncStateRow | unknown[] | null,
    fallbackUserId: string
) {
    if (Array.isArray(row)) {
        return {
            userId: row[0] ?? fallbackUserId,
            updatedAt: row[1] || '',
            isSelf: Boolean(row[2]),
            sourceLastCreatedAt: row[3] || '',
            pendingSessionStartAt:
                typeof row[4] === 'number' ? row[4] : (row[4] ?? null),
            cachedRangeDays: Number.parseInt(String(row[5] ?? 0), 10) || 0
        };
    }

    if (!row || typeof row !== 'object') {
        return null;
    }

    return {
        userId: row.user_id ?? row.userId ?? fallbackUserId,
        updatedAt: row.updated_at ?? row.updatedAt ?? '',
        isSelf: Boolean(row.is_self ?? row.isSelf),
        sourceLastCreatedAt:
            row.source_last_created_at ?? row.sourceLastCreatedAt ?? '',
        pendingSessionStartAt:
            row.pending_session_start_at ?? row.pendingSessionStartAt ?? null,
        cachedRangeDays:
            Number.parseInt(
                String(row.cached_range_days ?? row.cachedRangeDays ?? 0),
                10
            ) || 0
    };
}

function normalizeActivitySessionRow(
    row: ActivitySessionRow | unknown[] | null
) {
    if (Array.isArray(row)) {
        return {
            start: Number.parseInt(String(row[0] ?? 0), 10) || 0,
            end: Number.parseInt(String(row[1] ?? 0), 10) || 0,
            isOpenTail: Boolean(row[2]),
            sourceRevision: row[3] || ''
        };
    }

    if (!row || typeof row !== 'object') {
        return null;
    }

    return {
        start: Number.parseInt(String(row.start_at ?? row.start ?? 0), 10) || 0,
        end: Number.parseInt(String(row.end_at ?? row.end ?? 0), 10) || 0,
        isOpenTail: Boolean(row.is_open_tail ?? row.isOpenTail),
        sourceRevision: row.source_revision ?? row.sourceRevision ?? ''
    };
}

function normalizeLocationRow(row: ActivityLocationRow | unknown[] | null) {
    if (Array.isArray(row)) {
        return {
            created_at: row[0] ?? '',
            time: Number.parseInt(String(row[1] ?? 0), 10) || 0
        };
    }

    if (!row || typeof row !== 'object') {
        return null;
    }

    return {
        created_at: row.created_at ?? row.createdAt ?? '',
        time: Number.parseInt(String(row.time ?? 0), 10) || 0
    };
}

async function getSelfActivitySourceSlice({ fromDays, toDays = 0 }) {
    const fromDateIso = new Date(
        Date.now() - fromDays * 86400000
    ).toISOString();
    const toDateIso =
        toDays > 0
            ? new Date(Date.now() - toDays * 86400000).toISOString()
            : '';

    const rows = (await backend.app.ActivitySelfSourceSlice({
        query: {
            fromDateIso,
            toDateIso
        }
    })) as ActivityLocationRow[];

    if (!Array.isArray(rows)) {
        return [];
    }

    return rows
        .map(normalizeLocationRow)
        .filter((row) => typeof row?.created_at === 'string' && row.created_at);
}

async function getSelfActivitySourceAfter({
    afterCreatedAt,
    inclusive = false
}) {
    const rows = (await backend.app.ActivitySelfSourceAfter({
        query: {
            afterCreatedAt,
            inclusive
        }
    })) as ActivityLocationRow[];

    if (!Array.isArray(rows)) {
        return [];
    }

    return rows
        .map(normalizeLocationRow)
        .filter((row) => typeof row?.created_at === 'string' && row.created_at);
}

async function getFriendPresenceSlice({
    userId,
    fromDateIso,
    toDateIso = '',
    ownerUserId
}) {
    const rows = (await backend.app.ActivityFriendPresenceSlice({
        query: {
            ownerUserId,
            userId,
            fromDateIso,
            toDateIso
        }
    })) as Array<PresenceRow | unknown[]>;

    const output = Array.isArray(rows)
        ? rows.map((row) => ({
              created_at: Array.isArray(row) ? row[0] : row.created_at,
              type: Array.isArray(row) ? row[1] : row.type
          }))
        : [];

    return output.sort((left, right) =>
        String(left.created_at || '').localeCompare(
            String(right.created_at || '')
        )
    );
}

async function getFriendPresenceAfter({ userId, afterCreatedAt, ownerUserId }) {
    const rows = (await backend.app.ActivityFriendPresenceAfter({
        query: {
            ownerUserId,
            userId,
            afterCreatedAt
        }
    })) as Array<PresenceRow | unknown[]>;
    return Array.isArray(rows)
        ? rows.map((row) => ({
              created_at: Array.isArray(row) ? row[0] : row.created_at,
              type: Array.isArray(row) ? row[1] : row.type
          }))
        : [];
}

async function getActivitySourceSlice({
    userId,
    ownerUserId = '',
    isSelf,
    fromDays,
    toDays = 0
}) {
    if (isSelf) {
        return getSelfActivitySourceSlice({ fromDays, toDays });
    }

    const fromDateIso = new Date(
        Date.now() - fromDays * 86400000
    ).toISOString();
    const toDateIso =
        toDays > 0
            ? new Date(Date.now() - toDays * 86400000).toISOString()
            : '';
    return getFriendPresenceSlice({
        userId,
        fromDateIso,
        toDateIso,
        ownerUserId
    });
}

async function getActivitySourceAfter({
    userId,
    ownerUserId = '',
    isSelf,
    afterCreatedAt,
    inclusive = false
}) {
    return isSelf
        ? getSelfActivitySourceAfter({ afterCreatedAt, inclusive })
        : getFriendPresenceAfter({
              userId,
              afterCreatedAt,
              ownerUserId
          });
}

async function getActivitySyncState(userId) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        return null;
    }

    const row = (await backend.app.ActivitySyncStateGet({
        userId: normalizedUserId
    })) as ActivitySyncStateRow | unknown[] | null;

    if (!row) {
        return null;
    }

    return normalizeActivitySyncStateRow(row, normalizedUserId);
}

async function upsertActivitySyncState(entry: ActivitySyncStateInput) {
    const normalizedUserId =
        typeof entry?.userId === 'string'
            ? entry.userId.trim()
            : String(entry?.userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'ActivityRepository.upsertActivitySyncState requires a user id.'
        );
    }

    await backend.app.ActivitySyncStateUpsert({
        entry: {
            userId: normalizedUserId,
            updatedAt: entry.updatedAt || '',
            isSelf: Boolean(entry.isSelf),
            sourceLastCreatedAt: entry.sourceLastCreatedAt || '',
            pendingSessionStartAt: entry.pendingSessionStartAt ?? null,
            cachedRangeDays:
                Number.parseInt(String(entry.cachedRangeDays ?? 0), 10) || 0
        }
    });
}

async function refreshSelfActivitySessions({
    userId,
    mode,
    rangeDays = 0,
    nowMs
}: ActivitySelfSessionsRefreshInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'ActivityRepository.refreshSelfActivitySessions requires a user id.'
        );
    }

    const result = (await backend.app.ActivitySelfSessionsRefresh({
        userId: normalizedUserId,
        mode,
        rangeDays,
        ...(Number.isFinite(nowMs) ? { nowMs } : {})
    })) as ActivitySelfSessionsRefreshOutput | null;
    const sync = normalizeActivitySyncStateRow(
        result?.sync || null,
        normalizedUserId
    );
    const sessions = Array.isArray(result?.sessions)
        ? result.sessions
              .map(normalizeActivitySessionRow)
              .filter(
                  (row) =>
                      Number.isFinite(row?.start) &&
                      Number.isFinite(row?.end)
              )
        : [];

    return {
        sync:
            sync ||
            normalizeActivitySyncStateRow(null, normalizedUserId) ||
            {
                userId: normalizedUserId,
                updatedAt: '',
                isSelf: true,
                sourceLastCreatedAt: '',
                pendingSessionStartAt: null,
                cachedRangeDays: 0
            },
        sessions,
        sourceCount:
            Number.parseInt(
                String(result?.sourceCount ?? result?.source_count ?? 0),
                10
            ) || 0
    };
}

async function getActivitySessions(userId) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        return [];
    }

    const rows = (await backend.app.ActivitySessionsGet({
        userId: normalizedUserId
    })) as Array<ActivitySessionRow | unknown[]>;

    if (!Array.isArray(rows)) {
        return [];
    }

    return rows
        .map(normalizeActivitySessionRow)
        .filter(
            (row) => Number.isFinite(row?.start) && Number.isFinite(row?.end)
        );
}

async function replaceActivitySessions(userId, sessions = []) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();

    await backend.app.ActivitySessionsReplace({
        userId: normalizedUserId,
        sessions: Array.isArray(sessions) ? sessions : []
    });
}

async function appendActivitySessions({
    userId,
    sessions = [],
    replaceFromStartAt = null
}: AppendActivitySessionsInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();

    await backend.app.ActivitySessionsAppend({
        userId: normalizedUserId,
        sessions: Array.isArray(sessions) ? sessions : [],
        replaceFromStartAt:
            replaceFromStartAt !== null && replaceFromStartAt !== undefined
                ? replaceFromStartAt
                : null
    });
}

async function getActivityBucketCache({
    ownerUserId,
    targetUserId = '',
    rangeDays,
    viewKind,
    excludeKey = ''
}: ActivityBucketCacheQuery) {
    const row = (await backend.app.ActivityBucketCacheGet({
        query: {
            ownerUserId,
            targetUserId,
            rangeDays,
            viewKind,
            excludeKey
        }
    })) as
        | (ActivityBucketCacheRow & {
              ownerUserId?: unknown;
              rawBuckets?: unknown;
              normalizedBuckets?: unknown;
              summary?: unknown;
              builtAt?: unknown;
          })
        | null;
    if (!row) {
        return null;
    }
    return {
        ownerUserId: row.ownerUserId ?? row.user_id,
        targetUserId: row.targetUserId ?? row.target_user_id,
        rangeDays: row.rangeDays ?? row.range_days,
        viewKind: row.viewKind ?? row.view_kind,
        excludeKey: row.excludeKey ?? row.exclude_key ?? '',
        bucketVersion: row.bucketVersion ?? row.bucket_version ?? 1,
        builtFromCursor: row.builtFromCursor ?? row.built_from_cursor ?? '',
        rawBuckets: row.rawBuckets ?? [],
        normalizedBuckets: row.normalizedBuckets ?? [],
        summary: row.summary ?? {},
        builtAt: row.builtAt ?? row.built_at ?? ''
    };
}

async function upsertActivityBucketCache(entry: ActivityBucketCacheInput) {
    await backend.app.ActivityBucketCacheUpsert({
        entry: {
            ownerUserId: entry.ownerUserId,
            targetUserId: entry.targetUserId || '',
            rangeDays: entry.rangeDays,
            viewKind: entry.viewKind,
            excludeKey: entry.excludeKey || '',
            bucketVersion: entry.bucketVersion || 1,
            builtFromCursor: entry.builtFromCursor || '',
            rawBuckets: entry.rawBuckets || [],
            normalizedBuckets: entry.normalizedBuckets || [],
            summary: entry.summary || {},
            builtAt: entry.builtAt || ''
        }
    });
}

const activityRepository = Object.freeze({
    ACTIVITY_VIEW_KIND,
    getActivityBucketCache,
    getSelfActivitySourceSlice,
    getSelfActivitySourceAfter,
    getActivitySourceSlice,
    getActivitySourceAfter,
    getActivitySyncState,
    upsertActivitySyncState,
    refreshSelfActivitySessions,
    getActivitySessions,
    replaceActivitySessions,
    appendActivitySessions,
    upsertActivityBucketCache
});

export {
    ACTIVITY_VIEW_KIND,
    getActivityBucketCache,
    getActivitySourceAfter,
    getActivitySourceSlice,
    getSelfActivitySourceSlice,
    getSelfActivitySourceAfter,
    getActivitySyncState,
    upsertActivitySyncState,
    refreshSelfActivitySessions,
    getActivitySessions,
    replaceActivitySessions,
    appendActivitySessions,
    upsertActivityBucketCache
};
export default activityRepository;
