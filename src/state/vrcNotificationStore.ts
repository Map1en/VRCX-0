import { create } from 'zustand';

import {
    commands,
    type NotificationMarkSeenBatchItem,
    type NotificationMarkSeenEffect,
    type NotificationMarkSeenItemResult
} from '@/platform/tauri/bindings';
import notificationPersistenceRepository from '@/repositories/notificationPersistenceRepository';
import type {
    NotificationResponse,
    NotificationRow
} from '@/repositories/notificationPersistenceRepository';
import i18n from '@/services/i18nService';
import { sendNotificationButtonResponse } from '@/services/notificationActionService';
import {
    getNotificationCategory,
    getNotificationTs
} from '@/shared/utils/notificationCategory';
import { isInviteNotificationType } from '@/shared/utils/notificationLifecycle';
import { getDismissResponse } from '@/shared/utils/notificationResponse';
import {
    isNotificationExpired,
    isUnseenNotification,
    RECENT_WINDOW_MS
} from '@/shared/utils/notificationSeen';
import { isRecord } from '@/shared/utils/record';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

const pendingReadEffects = new Map<string, NotificationMarkSeenEffect>();
let notificationScopeGeneration = 0;
let notificationRowsRevision = 0;

import type { LoadStatus } from '@/domain/shared/types';

export type { LoadStatus };
type NotificationCategoryKey = 'friend' | 'group' | 'other';
type NotificationPatch = Partial<{
    displayName: string;
    senderDisplayName: string;
    senderUsername: string;
    worldName: string;
    displayLocation: string;
}>;
export type NotificationBucket = {
    unseen: NotificationRow[];
    recent: NotificationRow[];
};
type NotificationStateSnapshot = {
    rows: NotificationRow[];
    categories: NotificationCategories;
    unseenCount: number;
    pendingInviteCount: number;
    recentDismissibleCount: number;
    detail: string;
};
type NotificationDerivedState = Pick<
    NotificationStateSnapshot,
    | 'categories'
    | 'unseenCount'
    | 'pendingInviteCount'
    | 'recentDismissibleCount'
>;
const NOTIFICATION_ROWS_MAX_ENTRIES = 2000;

const NOTIFICATION_DETAILS_PATCH_KEYS = [
    'worldName',
    'displayLocation'
] as const;
const NOTIFICATION_PATCH_KEYS = [
    'displayName',
    'senderDisplayName',
    'senderUsername',
    'worldName',
    'displayLocation'
] as const;

function normalizeNotificationId(value: string | null | undefined): string {
    return value?.trim() ?? '';
}

function normalizeNotificationIds(value: string | string[]): string[] {
    return (Array.isArray(value) ? value : [value])
        .map((entry) => normalizeNotificationId(entry))
        .filter(Boolean);
}

function nonEmptyNotificationPatch(
    fields: NotificationPatch
): NotificationPatch {
    const patch: NotificationPatch = {};
    for (const key of NOTIFICATION_PATCH_KEYS) {
        const value = fields[key];
        if (typeof value === 'string' && value.trim() !== '') {
            patch[key] = value;
        }
    }
    return patch;
}

function notificationDetailsPatch(
    patch: NotificationPatch
): Record<string, unknown> {
    const detailsPatch: Record<string, unknown> = {};
    for (const key of NOTIFICATION_DETAILS_PATCH_KEYS) {
        if (patch[key]) {
            detailsPatch[key] = patch[key];
        }
    }
    return detailsPatch;
}

export type NotificationCategories = Record<
    NotificationCategoryKey,
    NotificationBucket
>;
type RuntimeAuthSnapshot = {
    currentUserId?: string | null;
    currentUserEndpoint?: string;
};
type NotificationOperationScope = {
    currentUserId: string;
    currentUserEndpoint: string;
    generation: number;
};
export type MarkAllSeenProgress = {
    total: number;
    done: number;
    activeId: string;
    queuedIds: string[];
};
export type MarkAllSeenRowState = 'queued' | 'active' | 'failed' | null;
export type MarkAllSeenResult = {
    failedCount: number;
};
export type MarkNotificationReadResult = {
    remoteFailed: boolean;
    message: string;
};
type VrcNotificationStore = {
    rows: NotificationRow[];
    categories: NotificationCategories;
    unseenCount: number;
    pendingInviteCount: number;
    recentDismissibleCount: number;
    isCenterOpen: boolean;
    loadStatus: LoadStatus;
    detail: string;
    markAllSeenProgress: MarkAllSeenProgress | null;
    markAllSeenFailedIds: string[];
    loadForCurrentUser(): Promise<NotificationRow[]>;
    refreshForCurrentUser(): Promise<NotificationRow[]>;
    setCenterOpen(isCenterOpen: boolean): void;
    openCenter(): void;
    upsertNotification(notification: NotificationRow): void;
    patchNotification(id: string, fields: NotificationPatch): void;
    expireNotifications(ids: string | string[]): void;
    markNotificationsSeen(ids: string | string[]): void;
    markNotificationRead(
        notification?: NotificationRow | null
    ): Promise<MarkNotificationReadResult>;
    markAllSeen(): Promise<MarkAllSeenResult>;
    resetVrcNotificationState(): void;
};

function createEmptyCategories(): NotificationCategories {
    return {
        friend: { unseen: [], recent: [] },
        group: { unseen: [], recent: [] },
        other: { unseen: [], recent: [] }
    };
}

function buildNotificationDerivedState(
    rows: NotificationRow[]
): NotificationDerivedState {
    const categories = createEmptyCategories();
    const recentCutoff = Date.now() - RECENT_WINDOW_MS;
    let unseenCount = 0;
    let pendingInviteCount = 0;
    let recentDismissibleCount = 0;

    for (const notification of rows) {
        if (isPendingInvite(notification)) {
            pendingInviteCount += 1;
        }
        const category = getNotificationCategory(
            String(notification?.type || '')
        );
        const bucket = categories[category] || categories.other;
        if (isUnseenNotification(notification)) {
            bucket.unseen.push(notification);
            unseenCount += 1;
            continue;
        }
        if (isRecentNotification(notification, recentCutoff)) {
            bucket.recent.push(notification);
            if (getDismissResponse(notification.responses)) {
                recentDismissibleCount += 1;
            }
        }
    }

    return {
        categories,
        unseenCount,
        pendingInviteCount,
        recentDismissibleCount
    };
}

function isRecentNotification(
    notification: NotificationRow,
    recentCutoff: number
): boolean {
    return (
        !isNotificationExpired(notification) &&
        getNotificationTs(notification) > recentCutoff
    );
}

function isRecentDismissible(
    notification: NotificationRow,
    recentCutoff: number
): boolean {
    return (
        !isUnseenNotification(notification) &&
        isRecentNotification(notification, recentCutoff) &&
        getDismissResponse(notification.responses) !== null
    );
}

function notificationRowsCapacity(currentLength: number): number {
    return Math.max(NOTIFICATION_ROWS_MAX_ENTRIES, currentLength);
}

function sortRows(rows: NotificationRow[]): NotificationRow[] {
    return [...rows].sort((left, right) => {
        const leftTime = getNotificationTs(left);
        const rightTime = getNotificationTs(right);
        if (leftTime !== rightTime) {
            return rightTime - leftTime;
        }
        return String(right?.id || '').localeCompare(String(left?.id || ''));
    });
}

function createNotificationStateFromSortedRows(
    rows: NotificationRow[],
    detail = '',
    capacity = Number.POSITIVE_INFINITY
): NotificationStateSnapshot {
    const cappedRows = rows.length > capacity ? rows.slice(0, capacity) : rows;
    return {
        rows: cappedRows,
        ...buildNotificationDerivedState(cappedRows),
        detail
    };
}

function createNotificationState(
    rows: NotificationRow[],
    detail = '',
    capacity = Number.POSITIVE_INFINITY
): NotificationStateSnapshot {
    return createNotificationStateFromSortedRows(
        sortRows(rows),
        detail,
        capacity
    );
}

function mergeLoadedNotificationRows(
    loadedRows: NotificationRow[],
    currentRows: NotificationRow[]
): NotificationRow[] {
    const loadedRowsById = new Map<string, NotificationRow>();
    for (const row of loadedRows) {
        if (row.id) {
            loadedRowsById.set(row.id, row);
        }
    }
    const currentIds = new Set<string>();
    const mergedCurrentRows = currentRows.map((row) => {
        if (!row.id) {
            return row;
        }
        currentIds.add(row.id);
        return { ...loadedRowsById.get(row.id), ...row };
    });
    return [
        ...mergedCurrentRows,
        ...loadedRows.filter((row) => !row.id || !currentIds.has(row.id))
    ];
}

function getCurrentAuth(): RuntimeAuthSnapshot {
    return useRuntimeStore.getState().auth;
}

function captureNotificationScope(): NotificationOperationScope | null {
    const auth = getCurrentAuth();
    const currentUserId = String(auth.currentUserId || '');
    if (!currentUserId) {
        return null;
    }
    return {
        currentUserId,
        currentUserEndpoint: String(auth.currentUserEndpoint || ''),
        generation: notificationScopeGeneration
    };
}

function isCurrentNotificationScope(
    scope: NotificationOperationScope
): boolean {
    const auth = getCurrentAuth();
    return (
        notificationScopeGeneration === scope.generation &&
        String(auth.currentUserId || '') === scope.currentUserId &&
        String(auth.currentUserEndpoint || '') === scope.currentUserEndpoint
    );
}

function isPendingInvite(notification: NotificationRow): boolean {
    return (
        isInviteNotificationType(notification.type) &&
        !isNotificationExpired(notification)
    );
}

function canMarkNotificationRead(notification: NotificationRow): boolean {
    return isUnseenNotification(notification) || isPendingInvite(notification);
}

function notificationMarkSeenBatchItem(
    notification: NotificationRow
): NotificationMarkSeenBatchItem | null {
    const id = normalizeNotificationId(notification.id);
    if (!id) {
        return null;
    }
    return {
        id,
        version: Number(notification.version) || 1,
        type: String(notification.type || '')
    };
}

function optimisticReadEffect(
    notification: NotificationRow
): NotificationMarkSeenEffect {
    return isPendingInvite(notification) && Number(notification.version) !== 2
        ? 'expired'
        : 'seen';
}

function applyReadEffects(
    rows: NotificationRow[],
    effects: ReadonlyMap<string, NotificationMarkSeenEffect>
): NotificationRow[] {
    if (!effects.size) {
        return rows;
    }
    const expiresAt = new Date().toISOString();
    return rows.map((row) => {
        const effect = row.id ? effects.get(row.id) : undefined;
        if (effect === 'expired') {
            return { ...row, expiresAt, expired: true, seen: true };
        }
        return effect === 'seen' ? { ...row, seen: true } : row;
    });
}

function readResultEffects(
    results: NotificationMarkSeenItemResult[]
): Map<string, NotificationMarkSeenEffect> {
    return new Map(results.map((result) => [result.id, result.effect]));
}

function toMarkReadBatch(rows: NotificationRow[]) {
    const items: NotificationMarkSeenBatchItem[] = [];
    const effects = new Map<string, NotificationMarkSeenEffect>();
    for (const notification of rows) {
        const item = notificationMarkSeenBatchItem(notification);
        if (item) {
            items.push(item);
            effects.set(item.id, optimisticReadEffect(notification));
        }
    }
    return { items, effects };
}

function applyReadEffectsToStore(
    effects: ReadonlyMap<string, NotificationMarkSeenEffect>
) {
    const idSet = new Set(effects.keys());
    useVrcNotificationStore.setState((state) => ({
        ...createNotificationStateFromSortedRows(
            applyReadEffects(state.rows, effects),
            state.detail
        ),
        markAllSeenFailedIds: withoutFailedIds(
            state.markAllSeenFailedIds,
            idSet
        )
    }));
    notificationRowsRevision += 1;
    syncShellUnseenCount(useVrcNotificationStore.getState().unseenCount);
}

async function runMarkReadBatch(
    scope: NotificationOperationScope,
    items: NotificationMarkSeenBatchItem[],
    effects: ReadonlyMap<string, NotificationMarkSeenEffect>
) {
    for (const [id, effect] of effects) {
        pendingReadEffects.set(id, effect);
    }
    applyReadEffectsToStore(effects);
    let result: Awaited<
        ReturnType<typeof commands.appNotificationMarkSeenBatch>
    >;
    try {
        result = await commands.appNotificationMarkSeenBatch({ items });
    } catch (error) {
        for (const id of effects.keys()) {
            pendingReadEffects.delete(id);
        }
        if (isCurrentNotificationScope(scope)) {
            await useVrcNotificationStore
                .getState()
                .loadForCurrentUser()
                .catch(() => {});
        }
        throw error;
    }
    for (const id of effects.keys()) {
        pendingReadEffects.delete(id);
    }
    if (isCurrentNotificationScope(scope)) {
        applyReadEffectsToStore(readResultEffects(result.items));
    }
    return result;
}

function syncShellUnseenCount(unseenCount: number, force = false) {
    useShellStore.getState().setVrcUnseenNotificationCount(unseenCount);
    if (force) {
        useShellStore.getState().updateTrayIconNotification(true);
    }
}

function withoutFailedIds(failedIds: string[], idSet: Set<string>): string[] {
    return failedIds.some((id) => idSet.has(id))
        ? failedIds.filter((id) => !idSet.has(id))
        : failedIds;
}

export function selectCanMarkAllSeen(
    state: Pick<
        VrcNotificationStore,
        | 'unseenCount'
        | 'pendingInviteCount'
        | 'recentDismissibleCount'
        | 'markAllSeenProgress'
    >
): boolean {
    return (
        state.markAllSeenProgress === null &&
        (state.unseenCount > 0 ||
            state.pendingInviteCount > 0 ||
            state.recentDismissibleCount > 0)
    );
}

export function selectMarkAllSeenRowState(
    state: Pick<
        VrcNotificationStore,
        'markAllSeenProgress' | 'markAllSeenFailedIds'
    >,
    id: string | null | undefined
): MarkAllSeenRowState {
    if (!id) {
        return null;
    }
    const progress = state.markAllSeenProgress;
    if (progress?.activeId === id) {
        return 'active';
    }
    if (progress?.queuedIds.includes(id)) {
        return 'queued';
    }
    return state.markAllSeenFailedIds.includes(id) ? 'failed' : null;
}

export const useVrcNotificationStore = create<VrcNotificationStore>(
    (set, get) => ({
        rows: [],
        categories: createEmptyCategories(),
        unseenCount: 0,
        pendingInviteCount: 0,
        recentDismissibleCount: 0,
        isCenterOpen: false,
        loadStatus: 'idle',
        detail: '',
        markAllSeenProgress: null,
        markAllSeenFailedIds: [],
        async loadForCurrentUser() {
            const scope = captureNotificationScope();
            if (!scope) {
                set({
                    rows: [],
                    categories: createEmptyCategories(),
                    unseenCount: 0,
                    pendingInviteCount: 0,
                    recentDismissibleCount: 0,
                    loadStatus: 'idle',
                    detail: i18n.t(
                        'view.notifications.toast.no_current_user_session'
                    )
                });
                notificationRowsRevision += 1;
                syncShellUnseenCount(0, true);
                return [];
            }

            set({ loadStatus: 'running', detail: '' });
            const rowsRevision = notificationRowsRevision;
            try {
                let rows = applyReadEffects(
                    await notificationPersistenceRepository.queryNotifications({
                        userId: scope.currentUserId
                    }),
                    pendingReadEffects
                );
                if (!isCurrentNotificationScope(scope)) {
                    return rows;
                }
                if (notificationRowsRevision !== rowsRevision) {
                    rows = mergeLoadedNotificationRows(rows, get().rows);
                }
                set({
                    ...createNotificationState(rows),
                    loadStatus: 'ready'
                });
                notificationRowsRevision += 1;
                syncShellUnseenCount(get().unseenCount, true);
                return rows;
            } catch (error) {
                if (!isCurrentNotificationScope(scope)) {
                    return [];
                }
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Failed to load VRChat notifications.';
                if (notificationRowsRevision !== rowsRevision) {
                    set({ loadStatus: 'error', detail: message });
                    syncShellUnseenCount(get().unseenCount, true);
                    throw error;
                }
                set({
                    rows: [],
                    categories: createEmptyCategories(),
                    unseenCount: 0,
                    pendingInviteCount: 0,
                    recentDismissibleCount: 0,
                    loadStatus: 'error',
                    detail: message
                });
                notificationRowsRevision += 1;
                syncShellUnseenCount(0, true);
                throw error;
            }
        },
        async refreshForCurrentUser() {
            const scope = captureNotificationScope();
            if (!scope) {
                return get().loadForCurrentUser();
            }
            set({ loadStatus: 'running', detail: '' });
            let syncFailed = false;
            let syncError: unknown;
            try {
                await commands.appNotificationSync();
            } catch (error) {
                syncFailed = true;
                syncError = error;
            }
            if (!isCurrentNotificationScope(scope)) {
                return [];
            }
            const rows = await get().loadForCurrentUser();
            if (!isCurrentNotificationScope(scope)) {
                return rows;
            }
            if (syncFailed) {
                set({
                    loadStatus: 'error',
                    detail:
                        syncError instanceof Error
                            ? syncError.message
                            : 'Failed to refresh VRChat notifications.'
                });
                throw syncError;
            }
            return rows;
        },
        setCenterOpen(isCenterOpen) {
            set({ isCenterOpen });
            if (isCenterOpen) {
                get()
                    .refreshForCurrentUser()
                    .catch(() => {});
            }
        },
        openCenter() {
            get().setCenterOpen(true);
        },
        upsertNotification(notification: NotificationRow) {
            if (!notification?.id) {
                return;
            }
            set((state) => {
                const existing =
                    state.rows.find((row) => row.id === notification.id) || {};
                const merged = { ...existing, ...notification };
                const rows = [
                    merged,
                    ...state.rows.filter((row) => row.id !== notification.id)
                ];
                const next = createNotificationState(
                    rows,
                    state.detail,
                    notificationRowsCapacity(state.rows.length)
                );
                if (next.rows.some((row) => row.id === notification.id)) {
                    return next;
                }
                return createNotificationState(
                    [merged, ...next.rows.slice(0, -1)],
                    state.detail
                );
            });
            notificationRowsRevision += 1;
            syncShellUnseenCount(get().unseenCount);
        },
        patchNotification(id, fields) {
            const normalizedId = normalizeNotificationId(id);
            if (!normalizedId) {
                return;
            }
            set((state) => {
                let changed = false;
                const rows = state.rows.map((row: NotificationRow) => {
                    if (row.id !== normalizedId) {
                        return row;
                    }
                    const patch = nonEmptyNotificationPatch(fields);
                    if (!Object.keys(patch).length) {
                        return row;
                    }
                    const details = isRecord(row.details) ? row.details : {};
                    const detailsPatch = notificationDetailsPatch(patch);
                    changed = true;
                    return {
                        ...row,
                        ...patch,
                        ...(Object.keys(detailsPatch).length
                            ? { details: { ...details, ...detailsPatch } }
                            : {})
                    };
                });
                return changed
                    ? createNotificationStateFromSortedRows(rows, state.detail)
                    : state;
            });
            notificationRowsRevision += 1;
            syncShellUnseenCount(get().unseenCount);
        },
        expireNotifications(ids) {
            const idSet = new Set(normalizeNotificationIds(ids));
            if (!idSet.size) {
                return;
            }
            const expiresAt = new Date().toISOString();
            set((state) => {
                const rows = state.rows.map((row) =>
                    row.id && idSet.has(row.id)
                        ? {
                              ...row,
                              expiresAt,
                              expired: true,
                              seen: true
                          }
                        : row
                );
                return {
                    ...createNotificationStateFromSortedRows(
                        rows,
                        state.detail
                    ),
                    markAllSeenFailedIds: withoutFailedIds(
                        state.markAllSeenFailedIds,
                        idSet
                    )
                };
            });
            notificationRowsRevision += 1;
            syncShellUnseenCount(get().unseenCount);
        },
        markNotificationsSeen(ids) {
            const idSet = new Set(normalizeNotificationIds(ids));
            if (!idSet.size) {
                return;
            }
            set((state) => {
                const rows = state.rows.map((row) =>
                    row.id && idSet.has(row.id)
                        ? {
                              ...row,
                              seen: true
                          }
                        : row
                );
                return {
                    ...createNotificationStateFromSortedRows(
                        rows,
                        state.detail
                    ),
                    markAllSeenFailedIds: withoutFailedIds(
                        state.markAllSeenFailedIds,
                        idSet
                    )
                };
            });
            notificationRowsRevision += 1;
            syncShellUnseenCount(get().unseenCount);
        },
        async markNotificationRead(notification?: NotificationRow | null) {
            const scope = captureNotificationScope();
            const item = notification
                ? notificationMarkSeenBatchItem(notification)
                : null;
            if (
                !scope ||
                !notification ||
                !item ||
                !canMarkNotificationRead(notification)
            ) {
                return { remoteFailed: false, message: '' };
            }
            const effects = new Map([
                [item.id, optimisticReadEffect(notification)]
            ]);
            const result = await runMarkReadBatch(scope, [item], effects);
            const failed = result.items.find(
                (resultItem) => resultItem.state === 'remoteFailed'
            );
            if (failed && isCurrentNotificationScope(scope)) {
                set((state) => ({
                    markAllSeenFailedIds: [
                        ...withoutFailedIds(
                            state.markAllSeenFailedIds,
                            new Set([failed.id])
                        ),
                        failed.id
                    ]
                }));
            }
            return {
                remoteFailed: Boolean(failed),
                message: failed?.message || ''
            };
        },
        async markAllSeen() {
            const scope = captureNotificationScope();
            const recentCutoff = Date.now() - RECENT_WINDOW_MS;
            const targetRows = get().rows.filter(
                (notification) =>
                    canMarkNotificationRead(notification) ||
                    isRecentDismissible(notification, recentCutoff)
            );
            if (!scope || get().markAllSeenProgress || !targetRows.length) {
                return { failedCount: 0 };
            }

            const dismissTargets: {
                notification: NotificationRow;
                response: NotificationResponse;
            }[] = [];
            const readRows: NotificationRow[] = [];
            for (const notification of targetRows) {
                const response =
                    isUnseenNotification(notification) ||
                    isRecentDismissible(notification, recentCutoff)
                        ? getDismissResponse(notification.responses)
                        : null;
                if (response) {
                    dismissTargets.push({ notification, response });
                } else {
                    readRows.push(notification);
                }
            }

            const readBatch = toMarkReadBatch(readRows);
            const dismissIds = dismissTargets.map((target) =>
                normalizeNotificationId(target.notification.id)
            );
            const updateProgress = (
                update: (progress: MarkAllSeenProgress) => MarkAllSeenProgress
            ) => {
                if (!isCurrentNotificationScope(scope)) {
                    return;
                }
                set((state) =>
                    state.markAllSeenProgress
                        ? {
                              markAllSeenProgress: update(
                                  state.markAllSeenProgress
                              )
                          }
                        : state
                );
            };
            set({
                markAllSeenProgress: {
                    total: readBatch.items.length + dismissIds.length,
                    done: 0,
                    activeId: '',
                    queuedIds: dismissIds
                },
                markAllSeenFailedIds: []
            });

            const failedIds: string[] = [];
            const collectRemoteFailures = (
                results: NotificationMarkSeenItemResult[]
            ) => {
                for (const result of results) {
                    if (result.state === 'remoteFailed') {
                        failedIds.push(result.id);
                        console.warn(
                            'Failed to mark VRChat notification as seen:',
                            result.message
                        );
                    }
                }
            };

            try {
                if (readBatch.items.length) {
                    const result = await runMarkReadBatch(
                        scope,
                        readBatch.items,
                        readBatch.effects
                    );
                    collectRemoteFailures(result.items);
                    updateProgress((progress) => ({
                        ...progress,
                        done: progress.done + readBatch.items.length
                    }));
                }

                const failedDismissRows: NotificationRow[] = [];
                for (const target of dismissTargets) {
                    if (!isCurrentNotificationScope(scope)) {
                        break;
                    }
                    const id = normalizeNotificationId(target.notification.id);
                    updateProgress((progress) => ({
                        ...progress,
                        activeId: id,
                        queuedIds: progress.queuedIds.filter(
                            (queuedId) => queuedId !== id
                        )
                    }));
                    try {
                        await sendNotificationButtonResponse({
                            currentUserId: scope.currentUserId,
                            notification: target.notification,
                            response: target.response
                        });
                        if (isCurrentNotificationScope(scope)) {
                            get().expireNotifications(id);
                        }
                    } catch (error) {
                        if (isUnseenNotification(target.notification)) {
                            failedDismissRows.push(target.notification);
                        } else {
                            failedIds.push(id);
                        }
                        console.warn(
                            'Failed to dismiss VRChat notification:',
                            error
                        );
                    }
                    updateProgress((progress) => ({
                        ...progress,
                        activeId: '',
                        done: progress.done + 1
                    }));
                }

                const fallbackBatch = toMarkReadBatch(failedDismissRows);
                if (
                    fallbackBatch.items.length &&
                    isCurrentNotificationScope(scope)
                ) {
                    const result = await runMarkReadBatch(
                        scope,
                        fallbackBatch.items,
                        fallbackBatch.effects
                    );
                    collectRemoteFailures(result.items);
                }

                if (isCurrentNotificationScope(scope) && dismissIds.length) {
                    await get().loadForCurrentUser();
                }
            } finally {
                if (isCurrentNotificationScope(scope)) {
                    set({
                        markAllSeenProgress: null,
                        markAllSeenFailedIds: failedIds
                    });
                }
            }
            return { failedCount: failedIds.length };
        },
        resetVrcNotificationState() {
            notificationScopeGeneration += 1;
            notificationRowsRevision += 1;
            set({
                rows: [],
                categories: createEmptyCategories(),
                unseenCount: 0,
                pendingInviteCount: 0,
                recentDismissibleCount: 0,
                isCenterOpen: false,
                loadStatus: 'idle',
                detail: '',
                markAllSeenProgress: null,
                markAllSeenFailedIds: []
            });
            syncShellUnseenCount(0);
        }
    })
);
