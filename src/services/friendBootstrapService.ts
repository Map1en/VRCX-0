import {
    commands,
    type SocialFriendRosterBaselineOutput
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import type { FriendLogHistoryEntry } from '@/repositories/friendLogHistoryRepository';
import friendLogRepository, {
    type FriendLogCurrentEntry,
    type FriendLogCurrentRow
} from '@/repositories/friendLogRepository';
import {
    computeTrustLevel,
    computeUserPlatform
} from '@/shared/utils/userTransforms';
import { useFriendLogStore } from '@/state/friendLogStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';

import { syncStartupServicesTask } from './startupServicesStatus';
import { notifyRuntimeVrchatAuthFailure } from './vrchatAuthErrorService';

type FriendBootstrapSnapshot = Record<string, unknown> & {
    friendsById?: unknown;
    orderedFriendIds?: unknown;
    onlineIds?: unknown;
    activeIds?: unknown;
    offlineIds?: unknown;
    detail?: unknown;
};
type FriendStateBucket = 'online' | 'active' | 'offline';
type FriendRecord = Record<string, unknown> & {
    id?: unknown;
    userId?: unknown;
    user_id?: unknown;
    displayName?: unknown;
    username?: unknown;
    tags?: unknown;
    developerType?: unknown;
    platform?: unknown;
    last_platform?: unknown;
    location?: unknown;
    state?: unknown;
    stateBucket?: unknown;
    trustLevel?: unknown;
    $trustLevel?: unknown;
    friendNumber?: unknown;
    $friendNumber?: unknown;
    $profileSource?: unknown;
};
type FriendLogRow = FriendLogCurrentRow & {
    user_id?: unknown;
    $friendNumber?: unknown;
    $trustLevel?: unknown;
};
type FriendLogSeedRow = Partial<FriendLogRow>;
type CurrentUserFriendSnapshot = Record<string, unknown> & {
    id?: unknown;
    friends?: unknown;
    offlineFriends?: unknown;
    activeFriends?: unknown;
    onlineFriends?: unknown;
};
type RecordFriendLogFriendOptions = {
    currentUserId?: unknown;
    targetUserId?: unknown;
    targetUser?: unknown;
    stateBucket?: unknown;
    nowIso?: () => string;
};
type RecordFriendLogFriendResult = {
    userId: string;
    targetUserId?: string;
    count: number;
    inserted?: boolean;
    historyCount: number;
};
type RecordFriendLogUnfriendOptions = {
    currentUserId?: unknown;
    targetUserId?: unknown;
    nowIso?: () => string;
};
type RecordFriendLogUnfriendResult = {
    userId: string;
    targetUserId: string;
    removedCount: number;
    historyCount: number;
};
type FriendBootstrapOptions = {
    userId?: unknown;
    endpoint?: unknown;
    websocket?: unknown;
    currentUserSnapshot?: unknown;
    preserveLoadedState?: boolean;
};
type FriendBootstrapResult = {
    userId: string;
    count: number;
    detail: string;
    stale: boolean;
};

const activeBootstraps = new Map<string, Promise<FriendBootstrapResult>>();
const friendLogMutationQueues = new Map<string, Promise<unknown>>();
const explicitFriendLogAddIntents = new Map<string, symbol>();
const explicitFriendLogAddIntentsHandledByBootstrap = new Set<string>();

function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeStateBucket(value: unknown) {
    const normalized = normalizeUserId(value).toLowerCase();
    if (
        normalized === 'online' ||
        normalized === 'active' ||
        normalized === 'offline'
    ) {
        return normalized;
    }
    return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function asFriendRecord(value: unknown): FriendRecord | null {
    return isRecord(value) ? (value as FriendRecord) : null;
}

function normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map((entry) => normalizeUserId(entry)).filter(Boolean)
        : [];
}

function normalizeFriendsById(
    value: unknown
): Record<string, Record<string, unknown>> {
    if (!isRecord(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value).filter(([, friend]) => isRecord(friend))
    ) as Record<string, Record<string, unknown>>;
}

function getDisplayName(user: Record<string, unknown> | null | undefined) {
    return (
        normalizeUserId(user?.displayName) ||
        normalizeUserId(user?.username) ||
        normalizeUserId(user?.id)
    );
}

function getMeaningfulDisplayName(
    user: FriendRecord | null | undefined,
    userId: unknown = ''
) {
    const normalizedUserId = normalizeUserId(userId || user?.id);
    for (const candidate of [user?.displayName, user?.username]) {
        const displayName = normalizeUserId(candidate);
        if (displayName && displayName !== normalizedUserId) {
            return displayName;
        }
    }
    return '';
}

function enqueueFriendLogMutation<T>(
    userId: unknown,
    mutation: () => T | Promise<T>
): Promise<T> {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return Promise.reject(
            new Error('Friend log mutation requires a current user id.')
        );
    }

    const previous =
        friendLogMutationQueues.get(normalizedUserId) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(mutation);
    let queued: Promise<unknown>;
    queued = run
        .catch(() => {})
        .finally(() => {
            if (friendLogMutationQueues.get(normalizedUserId) === queued) {
                friendLogMutationQueues.delete(normalizedUserId);
            }
        });
    friendLogMutationQueues.set(normalizedUserId, queued);
    return run;
}

function getExplicitFriendLogAddIntentKey(
    currentUserId: unknown,
    targetUserId: unknown
) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const normalizedTargetUserId = normalizeUserId(targetUserId);
    if (
        !normalizedCurrentUserId ||
        !normalizedTargetUserId ||
        normalizedCurrentUserId === normalizedTargetUserId
    ) {
        return '';
    }
    return `${normalizedCurrentUserId}\u0000${normalizedTargetUserId}`;
}

export function registerFriendLogExplicitAddIntent({
    currentUserId,
    targetUserId
}: {
    currentUserId?: unknown;
    targetUserId?: unknown;
}) {
    const key = getExplicitFriendLogAddIntentKey(currentUserId, targetUserId);
    if (!key) {
        return () => {};
    }

    const token = Symbol('friend-log-explicit-add');
    explicitFriendLogAddIntents.set(key, token);
    return () => {
        if (explicitFriendLogAddIntents.get(key) === token) {
            explicitFriendLogAddIntents.delete(key);
            explicitFriendLogAddIntentsHandledByBootstrap.delete(key);
        }
    };
}

function getExplicitFriendLogAddIntentUserIds(currentUserId: unknown) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    if (!normalizedCurrentUserId) {
        return [];
    }

    const prefix = `${normalizedCurrentUserId}\u0000`;
    return Array.from(explicitFriendLogAddIntents.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => normalizeUserId(key.slice(prefix.length)))
        .filter(Boolean);
}

function markExplicitFriendLogAddIntentsHandledByBootstrap(
    currentUserId: unknown,
    targetUserIds: unknown
) {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    if (!normalizedCurrentUserId || !Array.isArray(targetUserIds)) {
        return;
    }

    for (const targetUserId of targetUserIds) {
        const key = getExplicitFriendLogAddIntentKey(
            normalizedCurrentUserId,
            targetUserId
        );
        if (key && explicitFriendLogAddIntents.has(key)) {
            explicitFriendLogAddIntentsHandledByBootstrap.add(key);
        }
    }
}

function consumeExplicitFriendLogAddIntentHandledByBootstrap(
    currentUserId: unknown,
    targetUserId: unknown
) {
    const key = getExplicitFriendLogAddIntentKey(currentUserId, targetUserId);
    if (!key || !explicitFriendLogAddIntentsHandledByBootstrap.has(key)) {
        return false;
    }

    explicitFriendLogAddIntentsHandledByBootstrap.delete(key);
    return true;
}

function addStateBucketIds(
    stateById: Map<string, FriendStateBucket>,
    ids: unknown,
    state: FriendStateBucket
) {
    if (!Array.isArray(ids)) {
        return;
    }

    for (const value of ids) {
        const userId = normalizeUserId(value);
        if (!userId) {
            continue;
        }
        stateById.set(userId, state);
    }
}

function buildFriendStateMap(currentUserSnapshot: CurrentUserFriendSnapshot) {
    const stateById = new Map<string, FriendStateBucket>();
    addStateBucketIds(stateById, currentUserSnapshot?.friends, 'offline');
    addStateBucketIds(
        stateById,
        currentUserSnapshot?.offlineFriends,
        'offline'
    );
    addStateBucketIds(stateById, currentUserSnapshot?.activeFriends, 'active');
    addStateBucketIds(stateById, currentUserSnapshot?.onlineFriends, 'online');

    return stateById;
}

function hasCompleteFriendStateSnapshot(
    currentUserSnapshot: unknown
): currentUserSnapshot is CurrentUserFriendSnapshot {
    if (!isRecord(currentUserSnapshot)) {
        return false;
    }
    return (
        Array.isArray(currentUserSnapshot.friends) &&
        Array.isArray(currentUserSnapshot.offlineFriends) &&
        Array.isArray(currentUserSnapshot.activeFriends) &&
        Array.isArray(currentUserSnapshot.onlineFriends)
    );
}

function hasFriendListSnapshot(
    currentUserSnapshot: unknown
): currentUserSnapshot is CurrentUserFriendSnapshot & { friends: unknown[] } {
    return (
        isRecord(currentUserSnapshot) &&
        Array.isArray(currentUserSnapshot.friends)
    );
}

function buildUnfriendHistoryEntry(
    row: FriendLogRow,
    createdAt: string
): FriendLogHistoryEntry | null {
    const userId = normalizeUserId(row?.userId);
    if (!userId) {
        return null;
    }

    return {
        created_at: createdAt,
        type: 'Unfriend',
        userId,
        displayName: normalizeUserId(row?.displayName) || userId,
        friendNumber: Number(row?.friendNumber ?? row?.$friendNumber) || null
    };
}

function buildFriendHistoryEntry(
    row: FriendLogCurrentEntry,
    createdAt: string
): FriendLogHistoryEntry | null {
    const userId = normalizeUserId(row?.userId);
    if (!userId) {
        return null;
    }

    return {
        created_at: createdAt,
        type: 'Friend',
        userId,
        displayName: normalizeUserId(row?.displayName) || userId,
        trustLevel: normalizeUserId(row?.trustLevel),
        friendNumber: Number(row?.friendNumber) || null
    };
}

function getFriendLogInitKey(userId: string) {
    return `friendLogInit_${userId}`;
}

function buildCurrentEntryFromFriend({
    userId,
    friend,
    friendNumber
}: {
    userId: string;
    friend: FriendRecord | null | undefined;
    friendNumber: number;
}): FriendLogCurrentEntry {
    const trustLevel =
        normalizeUserId(friend?.$trustLevel || friend?.trustLevel) || 'Visitor';
    return {
        userId,
        displayName: getDisplayName(friend) || userId,
        trustLevel,
        friendNumber
    };
}

function signalFriendLogChanged() {
    useFriendLogStore.getState().bumpRevision();
    useShellStore.getState().notifyMenu('friend-log');
}

export async function recordFriendLogFriendByUserId({
    currentUserId,
    targetUserId,
    targetUser,
    stateBucket,
    nowIso = () => new Date().toJSON()
}: RecordFriendLogFriendOptions): Promise<RecordFriendLogFriendResult> {
    const targetUserRecord = asFriendRecord(targetUser);
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const normalizedTargetUserId = normalizeUserId(
        targetUserId || targetUserRecord?.id
    );
    if (
        !normalizedCurrentUserId ||
        !normalizedTargetUserId ||
        normalizedCurrentUserId === normalizedTargetUserId
    ) {
        return {
            userId: normalizedCurrentUserId,
            targetUserId: normalizedTargetUserId,
            count: 0,
            inserted: false,
            historyCount: 0
        };
    }

    return enqueueFriendLogMutation(normalizedCurrentUserId, async () => {
        const explicitAddIntentKey = getExplicitFriendLogAddIntentKey(
            normalizedCurrentUserId,
            normalizedTargetUserId
        );
        const hasExplicitAddIntent =
            Boolean(explicitAddIntentKey) &&
            explicitFriendLogAddIntents.has(explicitAddIntentKey);
        const wasHandledByBootstrap =
            consumeExplicitFriendLogAddIntentHandledByBootstrap(
                normalizedCurrentUserId,
                normalizedTargetUserId
            );
        const existingRows: FriendLogRow[] =
            await friendLogRepository.getFriendLogCurrent(
                normalizedCurrentUserId
            );
        const existingRow = existingRows.find(
            (entry) => normalizeUserId(entry?.userId) === normalizedTargetUserId
        );
        const maxFriendNumber = existingRows.reduce((maxValue, row) => {
            const friendNumber =
                Number.parseInt(String(row?.friendNumber ?? 0), 10) || 0;
            return Math.max(maxValue, friendNumber);
        }, 0);
        const nextFriendNumber =
            Number.parseInt(
                String(
                    targetUserRecord?.friendNumber ??
                        targetUserRecord?.$friendNumber ??
                        existingRow?.friendNumber ??
                        0
                ),
                10
            ) ||
            (maxFriendNumber > 0
                ? maxFriendNumber + 1
                : existingRows.length + 1);
        const source = targetUserRecord
            ? {
                  ...targetUserRecord,
                  id: normalizedTargetUserId,
                  friendNumber: nextFriendNumber,
                  $friendNumber: nextFriendNumber
              }
            : {
                  id: normalizedTargetUserId,
                  friendNumber: nextFriendNumber,
                  $friendNumber: nextFriendNumber
              };
        const normalizedStateBucket =
            normalizeStateBucket(stateBucket) ||
            normalizeStateBucket(source.stateBucket) ||
            normalizeStateBucket(source.state) ||
            'offline';
        const normalizedFriend = normalizeFriendEntry(
            source,
            normalizedStateBucket,
            existingRow ?? {
                userId: normalizedTargetUserId,
                displayName: getDisplayName(source) || normalizedTargetUserId,
                trustLevel: 'Visitor',
                friendNumber: nextFriendNumber
            }
        );
        const currentEntry: FriendLogCurrentEntry = {
            userId: normalizedTargetUserId,
            displayName: normalizeUserId(normalizedFriend.displayName),
            trustLevel: normalizeUserId(normalizedFriend.$trustLevel),
            friendNumber: Number(normalizedFriend.$friendNumber) || 0
        };
        const historyEntry = buildFriendHistoryEntry(currentEntry, nowIso());

        const result = await friendLogRepository.upsertFriendLogCurrent(
            normalizedCurrentUserId,
            currentEntry,
            {
                historyEntry: historyEntry ?? undefined,
                forceHistory: hasExplicitAddIntent && wasHandledByBootstrap
            }
        );
        if (hasExplicitAddIntent) {
            explicitFriendLogAddIntents.delete(explicitAddIntentKey);
        }
        if (result?.inserted || Number(result?.historyCount ?? 0) > 0) {
            signalFriendLogChanged();
        }
        return result;
    });
}

export async function recordFriendLogUnfriendByUserId({
    currentUserId,
    targetUserId,
    nowIso = () => new Date().toJSON()
}: RecordFriendLogUnfriendOptions): Promise<RecordFriendLogUnfriendResult> {
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const normalizedTargetUserId = normalizeUserId(targetUserId);
    if (!normalizedCurrentUserId || !normalizedTargetUserId) {
        return {
            userId: normalizedCurrentUserId,
            targetUserId: normalizedTargetUserId,
            removedCount: 0,
            historyCount: 0
        };
    }

    return enqueueFriendLogMutation(normalizedCurrentUserId, async () => {
        const existingRows: FriendLogRow[] =
            await friendLogRepository.getFriendLogCurrent(
                normalizedCurrentUserId
            );
        const row = existingRows.find(
            (entry) => normalizeUserId(entry?.userId) === normalizedTargetUserId
        );
        const historyEntry = row
            ? buildUnfriendHistoryEntry(row, nowIso())
            : null;
        if (!historyEntry) {
            return {
                userId: normalizedCurrentUserId,
                targetUserId: normalizedTargetUserId,
                removedCount: 0,
                historyCount: 0
            };
        }

        const result = await friendLogRepository.deleteFriendLogCurrentArray(
            normalizedCurrentUserId,
            [normalizedTargetUserId],
            { historyEntries: [historyEntry] }
        );

        if ((result?.count ?? 0) > 0 || (result?.historyCount ?? 0) > 0) {
            signalFriendLogChanged();
        }

        return {
            userId: normalizedCurrentUserId,
            targetUserId: normalizedTargetUserId,
            removedCount: result?.count ?? 0,
            historyCount: result?.historyCount ?? 0
        };
    });
}

function createFallbackFriendUser(
    userId: unknown,
    existingRow: FriendLogRow
): FriendRecord {
    const normalizedUserId = normalizeUserId(userId);
    return {
        id: normalizedUserId,
        displayName: existingRow?.displayName || normalizedUserId,
        username: '',
        tags: [],
        developerType: '',
        platform: 'offline',
        last_platform: '',
        location: 'offline',
        state: 'offline'
    };
}

function normalizeFriendEntry(
    friend: FriendRecord | null | undefined,
    stateBucket: string,
    existingRow: FriendLogRow
) {
    const source =
        friend ?? createFallbackFriendUser(existingRow?.userId, existingRow);
    const sourceRecord = source;
    const tags = Array.isArray(sourceRecord.tags)
        ? sourceRecord.tags.filter(
              (entry): entry is string => typeof entry === 'string'
          )
        : [];
    const trust = computeTrustLevel(
        tags,
        normalizeUserId(sourceRecord.developerType)
    );
    const explicitTrustLevel = normalizeUserId(
        sourceRecord.$trustLevel || sourceRecord.trustLevel
    );
    const hasTrustMetadata =
        Boolean(friend) &&
        (tags.length > 0 ||
            Boolean(sourceRecord.developerType) ||
            Boolean(explicitTrustLevel));
    const trustLevel =
        explicitTrustLevel ||
        (hasTrustMetadata
            ? trust.trustLevel
            : existingRow?.trustLevel || existingRow?.$trustLevel) ||
        trust.trustLevel;
    const friendNumber =
        Number.parseInt(
            String(
                sourceRecord?.friendNumber ??
                    sourceRecord?.$friendNumber ??
                    existingRow?.friendNumber ??
                    existingRow?.$friendNumber ??
                    0
            ),
            10
        ) || 0;
    const displayName =
        getMeaningfulDisplayName(
            sourceRecord,
            sourceRecord.id || existingRow?.userId
        ) ||
        existingRow?.displayName ||
        getDisplayName(sourceRecord) ||
        normalizeUserId(sourceRecord.id);

    return {
        ...sourceRecord,
        displayName,
        state: stateBucket,
        stateBucket,
        friendNumber,
        trustLevel,
        $friendNumber: friendNumber,
        $trustLevel: trustLevel,
        $trustClass: trust.trustClass,
        $trustSortNum: trust.trustSortNum,
        $isModerator: trust.isModerator,
        $isTroll: trust.isTroll,
        $isProbableTroll: trust.isProbableTroll,
        $platform: computeUserPlatform(
            normalizeUserId(sourceRecord.platform),
            normalizeUserId(sourceRecord.last_platform)
        )
    };
}

function buildFriendLogRowsById(rows: FriendLogRow[] = []) {
    const rowsById = new Map<string, FriendLogRow>();
    if (!Array.isArray(rows)) {
        return rowsById;
    }

    for (const row of rows) {
        const userId = normalizeUserId(row?.userId || row?.user_id);
        if (!userId) {
            continue;
        }
        rowsById.set(userId, row);
    }
    return rowsById;
}

function buildSeedRosterFriendsById(
    stateById: Map<string, FriendStateBucket>,
    friendLogRows: FriendLogRow[] = []
) {
    const rowsById = buildFriendLogRowsById(friendLogRows);
    const friendsById: Record<string, FriendRecord> = {};

    for (const [userId, stateBucket] of stateById.entries()) {
        const row: FriendLogSeedRow = rowsById.get(userId) ?? {};
        const trustLevel = normalizeUserId(row?.trustLevel) || 'Visitor';
        const friendNumber =
            Number.parseInt(
                String(row?.friendNumber ?? row?.$friendNumber ?? 0),
                10
            ) || 0;
        const displayName = normalizeUserId(row?.displayName) || userId;
        friendsById[userId] = {
            id: userId,
            displayName,
            username: '',
            tags: [],
            developerType: '',
            platform: 'offline',
            last_platform: '',
            location: 'offline',
            state: stateBucket,
            stateBucket,
            trustLevel,
            $trustLevel: trustLevel,
            friendNumber,
            $friendNumber: friendNumber
        };
    }

    return friendsById;
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
