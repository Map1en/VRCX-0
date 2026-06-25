import type { FriendLogHistoryEntry } from '@/repositories/friendLogHistoryRepository';
import friendLogRepository, {
    type FriendLogCurrentEntry
} from '@/repositories/friendLogRepository';
import { useFriendLogStore } from '@/state/friendLogStore';
import { useShellStore } from '@/state/shellStore';

import {
    asFriendRecord,
    getDisplayName,
    normalizeFriendEntry,
    normalizeStateBucket,
    normalizeUserId,
    type FriendLogRow,
    type RecordFriendLogFriendOptions,
    type RecordFriendLogFriendResult,
    type RecordFriendLogUnfriendOptions,
    type RecordFriendLogUnfriendResult
} from './friendBootstrapModel';

const friendLogMutationQueues = new Map<string, Promise<unknown>>();
const explicitFriendLogAddIntents = new Map<string, symbol>();
const explicitFriendLogAddIntentsHandledByBootstrap = new Set<string>();

export function enqueueFriendLogMutation<T>(
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

export function getExplicitFriendLogAddIntentUserIds(currentUserId: unknown) {
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

export function markExplicitFriendLogAddIntentsHandledByBootstrap(
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

export function signalFriendLogChanged() {
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
