import { commands } from '@/platform/tauri/bindings';
import type {
    ActivityFriendPresenceAfterInput,
    ActivityFriendPresenceSliceInput
} from '@/platform/tauri/bindings';
import type { ActivitySession } from '@/shared/utils/activityEngine';

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
    sessions?: ActivitySessionRow[];
    sourceCount?: unknown;
    source_count?: unknown;
}

interface ActivitySourceBoundsRow extends ObjectRow {
    firstCreatedAt?: unknown;
    first_created_at?: unknown;
    lastCreatedAt?: unknown;
    last_created_at?: unknown;
    count?: unknown;
}

interface ActivitySourceSliceInput {
    fromDays: number;
    toDays?: number;
}

interface ActivitySelfSourceAfterInput {
    afterCreatedAt: string;
    inclusive?: boolean;
}

interface FriendPresenceSliceInput {
    userId: unknown;
    ownerUserId: unknown;
    fromDateIso: string;
    toDateIso?: string;
}

interface FriendPresenceAfterInput {
    userId: unknown;
    ownerUserId: unknown;
    afterCreatedAt: string;
}

interface ActivitySourceQuery extends ActivitySourceSliceInput {
    userId?: unknown;
    ownerUserId?: unknown;
    isSelf?: boolean;
}

interface ActivitySourceAfterQuery extends ActivitySelfSourceAfterInput {
    userId?: unknown;
    ownerUserId?: unknown;
    isSelf?: boolean;
}

type NormalizedActivityLocation = {
    created_at: unknown;
    time: number;
};

type NormalizedPresence = {
    created_at: unknown;
    type: unknown;
};

type NormalizedActivitySession = {
    start: number;
    end: number;
    isOpenTail: boolean;
    sourceRevision: unknown;
};

const ACTIVITY_VIEW_KIND = Object.freeze({
    ACTIVITY: 'activity',
    OVERLAP: 'overlap'
});

function normalizeActivitySyncStateRow(
    row: ActivitySyncStateRow | null,
    fallbackUserId: string
) {
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
    row: ActivitySessionRow | null
): NormalizedActivitySession | null {
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

function normalizeLocationRow(
    row: ActivityLocationRow | null
): NormalizedActivityLocation | null {
    if (!row || typeof row !== 'object') {
        return null;
    }

    return {
        created_at: row.created_at ?? row.createdAt ?? '',
        time: Number.parseInt(String(row.time ?? 0), 10) || 0
    };
}

function normalizePresenceRow(
    row: PresenceRow | null
): NormalizedPresence | null {
    if (!row || typeof row !== 'object') {
        return null;
    }
    return {
        created_at: row.created_at ?? '',
        type: row.type ?? ''
    };
}

function hasCreatedAt<T extends { created_at: unknown }>(
    row: T | null
): row is T {
    return typeof row?.created_at === 'string' && Boolean(row.created_at);
}

async function getSelfActivitySourceSlice({
    fromDays,
    toDays = 0
}: ActivitySourceSliceInput) {
    const fromDateIso = new Date(
        Date.now() - fromDays * 86400000
    ).toISOString();
    const toDateIso =
        toDays > 0
            ? new Date(Date.now() - toDays * 86400000).toISOString()
            : '';

    const rows = (await commands.appActivitySelfSourceSlice({
        fromDateIso,
        toDateIso
    })) as ActivityLocationRow[];

    if (!Array.isArray(rows)) {
        return [];
    }

    return rows.map(normalizeLocationRow).filter(hasCreatedAt);
}

async function getSelfActivitySourceAfter({
    afterCreatedAt,
    inclusive = false
}: ActivitySelfSourceAfterInput) {
    const rows = (await commands.appActivitySelfSourceAfter({
        afterCreatedAt,
        inclusive
    })) as ActivityLocationRow[];

    if (!Array.isArray(rows)) {
        return [];
    }

    return rows.map(normalizeLocationRow).filter(hasCreatedAt);
}

async function getSelfActivitySourceBounds() {
    const row =
        ((await commands.appActivitySelfSourceBounds()) as ActivitySourceBoundsRow | null) ||
        {};
    return {
        firstCreatedAt: String(
            row.firstCreatedAt ?? row.first_created_at ?? ''
        ),
        lastCreatedAt: String(row.lastCreatedAt ?? row.last_created_at ?? ''),
        count: Number.parseInt(String(row.count ?? 0), 10) || 0
    };
}

async function getFriendPresenceSlice({
    userId,
    fromDateIso,
    toDateIso = '',
    ownerUserId
}: FriendPresenceSliceInput) {
    const input: ActivityFriendPresenceSliceInput = {
        ownerUserId: String(ownerUserId ?? ''),
        userId: String(userId ?? ''),
        fromDateIso: String(fromDateIso ?? ''),
        toDateIso: String(toDateIso ?? '')
    };
    const rows = (await commands.appActivityFriendPresenceSlice(
        input
    )) as PresenceRow[];

    const output = Array.isArray(rows)
        ? rows.map(normalizePresenceRow).filter(hasCreatedAt)
        : [];

    return output.sort((left, right) =>
        String(left.created_at || '').localeCompare(
            String(right.created_at || '')
        )
    );
}

async function getFriendPresenceAfter({
    userId,
    afterCreatedAt,
    ownerUserId
}: FriendPresenceAfterInput) {
    const input: ActivityFriendPresenceAfterInput = {
        ownerUserId: String(ownerUserId ?? ''),
        userId: String(userId ?? ''),
        afterCreatedAt: String(afterCreatedAt ?? '')
    };
    const rows = (await commands.appActivityFriendPresenceAfter(
        input
    )) as PresenceRow[];
    return Array.isArray(rows)
        ? rows.map(normalizePresenceRow).filter(hasCreatedAt)
        : [];
}

async function getActivitySourceSlice({
    userId,
    ownerUserId = '',
    isSelf,
    fromDays,
    toDays = 0
}: ActivitySourceQuery) {
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
}: ActivitySourceAfterQuery) {
    return isSelf
        ? getSelfActivitySourceAfter({ afterCreatedAt, inclusive })
        : getFriendPresenceAfter({
              userId,
              afterCreatedAt,
              ownerUserId
          });
}

async function getActivitySyncState(userId: unknown) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        return null;
    }

    const row = (await commands.appActivitySyncStateGet(
        normalizedUserId
    )) as ActivitySyncStateRow | null;

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

    await commands.appActivitySyncStateUpsert({
        userId: normalizedUserId,
        updatedAt: entry.updatedAt || '',
        isSelf: Boolean(entry.isSelf),
        sourceLastCreatedAt: entry.sourceLastCreatedAt || '',
        pendingSessionStartAt: entry.pendingSessionStartAt ?? null,
        cachedRangeDays:
            Number.parseInt(String(entry.cachedRangeDays ?? 0), 10) || 0
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

    const result = (await commands.appActivitySelfSessionsRefresh({
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
                  (row): row is NormalizedActivitySession =>
                      Number.isFinite(row?.start) && Number.isFinite(row?.end)
              )
        : [];

    return {
        sync: sync ||
            normalizeActivitySyncStateRow(null, normalizedUserId) || {
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

async function getActivitySessions(userId: unknown) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        return [];
    }

    const rows = (await commands.appActivitySessionsGet(
        normalizedUserId
    )) as ActivitySessionRow[];

    if (!Array.isArray(rows)) {
        return [];
    }

    return rows
        .map(normalizeActivitySessionRow)
        .filter(
            (row): row is NormalizedActivitySession =>
                Number.isFinite(row?.start) && Number.isFinite(row?.end)
        );
}

async function replaceActivitySessions(
    userId: unknown,
    sessions: ActivitySession[] = []
) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();

    await commands.appActivitySessionsReplace(
        normalizedUserId,
        Array.isArray(sessions) ? sessions : []
    );
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

    await commands.appActivitySessionsAppend(
        normalizedUserId,
        Array.isArray(sessions) ? sessions : [],
        replaceFromStartAt !== null && replaceFromStartAt !== undefined
            ? replaceFromStartAt
            : null
    );
}

async function getActivityBucketCache({
    ownerUserId,
    targetUserId = '',
    rangeDays,
    viewKind,
    excludeKey = ''
}: ActivityBucketCacheQuery) {
    const row = (await commands.appActivityBucketCacheGet({
        ownerUserId,
        targetUserId,
        rangeDays,
        viewKind,
        excludeKey
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
    await commands.appActivityBucketCacheUpsert({
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
    });
}

const activityPersistenceRepository = Object.freeze({
    ACTIVITY_VIEW_KIND,
    getActivityBucketCache,
    getSelfActivitySourceSlice,
    getSelfActivitySourceAfter,
    getSelfActivitySourceBounds,
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
    getSelfActivitySourceBounds,
    getActivitySyncState,
    upsertActivitySyncState,
    refreshSelfActivitySessions,
    getActivitySessions,
    replaceActivitySessions,
    appendActivitySessions,
    upsertActivityBucketCache
};
export default activityPersistenceRepository;
