import { backend } from '@/platform/index.js';
import type { ActivitySession } from '@/shared/utils/activityEngine.js';

import {
    buildUserTableName,
    normalizeUserTablePrefix
} from './localDatabaseSchema.js';
import sqliteRepository from './sqliteRepository.js';

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

const ACTIVITY_VIEW_KIND = Object.freeze({
    ACTIVITY: 'activity',
    OVERLAP: 'overlap'
});

function getSyncStateTable(userId: unknown): string {
    return `${normalizeUserTablePrefix(userId)}_activity_sync_state_v2`;
}

function getSessionsTable(userId: unknown): string {
    return `${normalizeUserTablePrefix(userId)}_activity_sessions_v2`;
}

function getBucketCacheTable(userId: unknown): string {
    return buildUserTableName(userId, 'activity_bucket_cache_v2');
}

function getFeedOnlineOfflineTable(ownerUserId: unknown): string {
    return buildUserTableName(ownerUserId, 'feed_online_offline');
}

function parseJson<T>(value: unknown, fallback: T): T | unknown {
    if (!value) {
        return fallback;
    }
    try {
        return JSON.parse(String(value));
    } catch {
        return fallback;
    }
}

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

    const rows = await sqliteRepository.query<ActivityLocationRow>(
        `
            SELECT created_at, time
            FROM (
                SELECT created_at, time, 0 AS sort_group
                FROM (
                    SELECT created_at, time
                    FROM gamelog_location
                    WHERE created_at < @fromDateIso
                    ORDER BY created_at DESC
                    LIMIT 1
                )
                UNION ALL
                SELECT created_at, time, 1 AS sort_group
                FROM gamelog_location
                WHERE created_at >= @fromDateIso
                  ${toDateIso ? 'AND created_at < @toDateIso' : ''}
                ${
                    toDateIso
                        ? `UNION ALL
                SELECT created_at, time, 2 AS sort_group
                FROM (
                    SELECT created_at, time
                    FROM gamelog_location
                    WHERE created_at >= @toDateIso
                    ORDER BY created_at
                    LIMIT 1
                )`
                        : ''
                }
            )
            ORDER BY created_at ASC, sort_group ASC
        `,
        {
            '@fromDateIso': fromDateIso,
            '@toDateIso': toDateIso
        }
    );

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
    const operator = inclusive ? '>=' : '>';
    const rows = await sqliteRepository.query<ActivityLocationRow>(
        `SELECT created_at, time
         FROM gamelog_location
         WHERE created_at ${operator} @afterCreatedAt
         ORDER BY created_at`,
        {
            '@afterCreatedAt': afterCreatedAt
        }
    );

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
    const tableName = getFeedOnlineOfflineTable(ownerUserId);
    const rows = await sqliteRepository.query<PresenceRow | unknown[]>(
        `
            SELECT created_at, type
            FROM (
                SELECT created_at, type, 0 AS sort_group
                FROM (
                    SELECT created_at, type
                    FROM ${tableName}
                    WHERE user_id = @userId
                      AND (type = 'Online' OR type = 'Offline')
                      AND created_at < @fromDateIso
                    ORDER BY created_at DESC
                    LIMIT 1
                )
                UNION ALL
                SELECT created_at, type, 1 AS sort_group
                FROM ${tableName}
                WHERE user_id = @userId
                  AND (type = 'Online' OR type = 'Offline')
                  AND created_at >= @fromDateIso
                  ${toDateIso ? 'AND created_at < @toDateIso' : ''}
            )
            ORDER BY created_at ASC, sort_group ASC
        `,
        {
            '@userId': userId,
            '@fromDateIso': fromDateIso,
            '@toDateIso': toDateIso
        }
    );

    const output = Array.isArray(rows)
        ? rows.map((row) => ({
              created_at: Array.isArray(row) ? row[0] : row.created_at,
              type: Array.isArray(row) ? row[1] : row.type
          }))
        : [];

    if (toDateIso) {
        const tailRows = await sqliteRepository.query<PresenceRow | unknown[]>(
            `SELECT created_at, type
             FROM ${tableName}
             WHERE user_id = @userId
               AND (type = 'Online' OR type = 'Offline')
               AND created_at >= @toDateIso
             ORDER BY created_at ASC
             LIMIT 1`,
            {
                '@userId': userId,
                '@toDateIso': toDateIso
            }
        );
        for (const row of tailRows ?? []) {
            output.push({
                created_at: Array.isArray(row) ? row[0] : row.created_at,
                type: Array.isArray(row) ? row[1] : row.type
            });
        }
    }

    return output.sort((left, right) =>
        String(left.created_at || '').localeCompare(
            String(right.created_at || '')
        )
    );
}

async function getFriendPresenceAfter({ userId, afterCreatedAt, ownerUserId }) {
    const tableName = getFeedOnlineOfflineTable(ownerUserId);
    const rows = await sqliteRepository.query<PresenceRow | unknown[]>(
        `SELECT created_at, type
         FROM ${tableName}
         WHERE user_id = @userId
           AND (type = 'Online' OR type = 'Offline')
           AND created_at > @afterCreatedAt
         ORDER BY created_at`,
        {
            '@userId': userId,
            '@afterCreatedAt': afterCreatedAt
        }
    );
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

    const rows = await sqliteRepository.query<ActivitySyncStateRow | unknown[]>(
        `SELECT user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days
         FROM ${getSyncStateTable(normalizedUserId)}
         WHERE user_id = @userId
         LIMIT 1`,
        {
            '@userId': normalizedUserId
        }
    );

    if (!Array.isArray(rows) || rows.length === 0) {
        return null;
    }

    return normalizeActivitySyncStateRow(rows[0], normalizedUserId);
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

async function getActivitySessions(userId) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        return [];
    }

    const rows = await sqliteRepository.query<ActivitySessionRow | unknown[]>(
        `SELECT start_at, end_at, is_open_tail, source_revision
         FROM ${getSessionsTable(normalizedUserId)}
         WHERE user_id = @userId
         ORDER BY start_at`,
        {
            '@userId': normalizedUserId
        }
    );

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
    const rows = await sqliteRepository.query<
        ActivityBucketCacheRow | unknown[]
    >(
        `SELECT user_id, target_user_id, range_days, view_kind, exclude_key, bucket_version, built_from_cursor, raw_buckets_json, normalized_buckets_json, summary_json, built_at
         FROM ${getBucketCacheTable(ownerUserId)}
         WHERE user_id = @ownerUserId AND target_user_id = @targetUserId AND range_days = @rangeDays AND view_kind = @viewKind AND exclude_key = @excludeKey
         LIMIT 1`,
        {
            '@ownerUserId': ownerUserId,
            '@targetUserId': targetUserId,
            '@rangeDays': rangeDays,
            '@viewKind': viewKind,
            '@excludeKey': excludeKey
        }
    );
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!row) {
        return null;
    }
    const read = (index, key) => (Array.isArray(row) ? row[index] : row[key]);
    return {
        ownerUserId: read(0, 'user_id'),
        targetUserId: read(1, 'target_user_id'),
        rangeDays: read(2, 'range_days'),
        viewKind: read(3, 'view_kind'),
        excludeKey: read(4, 'exclude_key') || '',
        bucketVersion: read(5, 'bucket_version') || 1,
        builtFromCursor: read(6, 'built_from_cursor') || '',
        rawBuckets: parseJson(read(7, 'raw_buckets_json'), []),
        normalizedBuckets: parseJson(read(8, 'normalized_buckets_json'), []),
        summary: parseJson(read(9, 'summary_json'), {}),
        builtAt: read(10, 'built_at') || ''
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
    getActivitySessions,
    replaceActivitySessions,
    appendActivitySessions,
    upsertActivityBucketCache
};
export default activityRepository;
