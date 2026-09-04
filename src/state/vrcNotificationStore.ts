import { create } from 'zustand';

import {
    commands,
    type NotificationMarkSeenBatchItem,
    type NotificationMarkSeenItemResult
} from '@/platform/tauri/bindings';
import notificationPersistenceRepository from '@/repositories/notificationPersistenceRepository';
import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import {
    getNotificationCategory,
    getNotificationTs
} from '@/shared/utils/notificationCategory';
import {
    isNotificationExpired,
    isUnseenNotification,
    RECENT_WINDOW_MS,
    shouldMarkSeenRemotely
} from '@/shared/utils/notificationSeen';
import { isRecord } from '@/shared/utils/record';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

const pendingSeenIds = new Set<string>();
let notificationScopeGeneration = 0;
let notificationRowsRevision = 0;

import type { LoadStatus } from '@/domain/shared/types';

export type { LoadStatus };
export type NotificationCategoryKey = 'friend' | 'group' | 'other';
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
    detail: string;
};
type NotificationDerivedState = Pick<
    NotificationStateSnapshot,
    'categories' | 'unseenCount'
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
type VrcNotificationStore = {
    rows: NotificationRow[];
    categories: NotificationCategories;
    unseenCount: number;
    isCenterOpen: boolean;
    loadStatus: LoadStatus;
    detail: string;
    loadForCurrentUser(): Promise<NotificationRow[]>;
    refreshForCurrentUser(): Promise<NotificationRow[]>;
    setCenterOpen(isCenterOpen: boolean): void;
    openCenter(): void;
    upsertNotification(notification: NotificationRow): void;
    patchNotification(id: string, fields: NotificationPatch): void;
    expireNotifications(ids: string | string[]): void;
    markNotificationsSeen(ids: string | string[]): void;
    markNotificationSeen(notification?: NotificationRow | null): Promise<void>;
    markAllSeen(): Promise<void>;
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

    for (const notification of rows) {
        const category = getNotificationCategory(
            String(notification?.type || '')
        );
        const bucket = categories[category] || categories.other;
        if (isUnseenNotification(notification)) {
            bucket.unseen.push(notification);
            unseenCount += 1;
            continue;
        }
        if (
            !isNotificationExpired(notification) &&
            getNotificationTs(notification) > recentCutoff
        ) {
            bucket.recent.push(notification);
        }
    }

    return { categories, unseenCount };
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

function getUnseenRows(rows: NotificationRow[]): NotificationRow[] {
    return rows.filter(isUnseenNotification);
}

function notificationMarkSeenBatchItem(
    notification: NotificationRow
): NotificationMarkSeenBatchItem | null {
    const id = normalizeNotificationId(notification.id);
    const version = Number(notification.version) || 1;
    const remote = shouldMarkSeenRemotely(notification);
    if (!id || (!remote && version !== 2)) {
        return null;
    }
    return {
        id,
        version,
        location: remote ? 'remote' : 'local'
    };
}

function applyMarkSeenResults(
    rows: NotificationRow[],
    results: NotificationMarkSeenItemResult[]
): NotificationRow[] {
    const seenIds = new Set(
        results.flatMap((result) =>
            result.state === 'succeeded' && result.effect === 'seen'
                ? [result.id]
                : []
        )
    );
    if (!seenIds.size) {
        return rows;
    }
    return rows.map((row) =>
        row.id && seenIds.has(row.id) ? { ...row, seen: true } : row
    );
}

function applyPendingSeenRows(rows: NotificationRow[]): NotificationRow[] {
    if (!pendingSeenIds.size) {
        return rows;
    }
    return rows.map((row) =>
        row.id && pendingSeenIds.has(row.id)
            ? {
                  ...row,
                  seen: true
              }
            : row
    );
}

function syncShellUnseenCount(unseenCount: number, force = false) {
    useShellStore.getState().setVrcUnseenNotificationCount(unseenCount);
    if (force) {
        useShellStore.getState().updateTrayIconNotification(true);
    }
}

export const useVrcNotificationStore = create<VrcNotificationStore>(
    (set, get) => ({
        rows: [],
        categories: createEmptyCategories(),
        unseenCount: 0,
        isCenterOpen: false,
        loadStatus: 'idle',
        detail: '',
        async loadForCurrentUser() {
            const scope = captureNotificationScope();
            if (!scope) {
                set({
                    rows: [],
                    categories: createEmptyCategories(),
                    unseenCount: 0,
                    loadStatus: 'idle',
                    detail: 'No current user session is available.'
                });
                notificationRowsRevision += 1;
                syncShellUnseenCount(0, true);
                return [];
            }

            set({ loadStatus: 'running', detail: '' });
            const rowsRevision = notificationRowsRevision;
            try {
                let rows = applyPendingSeenRows(
                    await notificationPersistenceRepository.queryNotifications({
                        userId: scope.currentUserId
                    })
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
                return createNotificationStateFromSortedRows(
                    rows,
                    state.detail
                );
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
                return createNotificationStateFromSortedRows(
                    rows,
                    state.detail
                );
            });
            notificationRowsRevision += 1;
            syncShellUnseenCount(get().unseenCount);
        },
        async markNotificationSeen(notification?: NotificationRow | null) {
            const auth = getCurrentAuth();
            const item = notification
                ? notificationMarkSeenBatchItem(notification)
                : null;
            if (
                !auth.currentUserId ||
                !item ||
                !isUnseenNotification(notification)
            ) {
                return;
            }
            pendingSeenIds.add(item.id);
            get().markNotificationsSeen(item.id);
            let failedCount = 0;
            let failureMessage = '';
            try {
                const result = await commands.appNotificationMarkSeenBatch({
                    items: [item]
                });
                failedCount = result.failed;
                failureMessage = result.lastError || '';
                for (const resultItem of result.items) {
                    pendingSeenIds.delete(resultItem.id);
                }
                set((state) =>
                    createNotificationStateFromSortedRows(
                        applyMarkSeenResults(state.rows, result.items),
                        state.detail
                    )
                );
                notificationRowsRevision += 1;
                syncShellUnseenCount(get().unseenCount);
                if (failedCount > 0) {
                    await get().loadForCurrentUser();
                }
            } catch (error) {
                pendingSeenIds.delete(item.id);
                await get()
                    .loadForCurrentUser()
                    .catch(() => {});
                throw error;
            } finally {
                pendingSeenIds.delete(item.id);
            }
            if (failedCount > 0) {
                throw new Error(
                    failureMessage || 'Failed to mark the notification as seen.'
                );
            }
        },
        async markAllSeen() {
            const auth = getCurrentAuth();
            const unseenRows = getUnseenRows(get().rows);
            if (!auth.currentUserId || !unseenRows.length) {
                return;
            }

            const items = unseenRows.flatMap<NotificationMarkSeenBatchItem>(
                (notification) => {
                    const item = notificationMarkSeenBatchItem(notification);
                    return item ? [item] : [];
                }
            );
            const ids = items.map((item) => item.id);
            if (!ids.length) {
                return;
            }
            for (const id of ids) {
                pendingSeenIds.add(id);
            }
            get().markNotificationsSeen(ids);
            let failedCount = 0;
            try {
                const result = await commands.appNotificationMarkSeenBatch({
                    items
                });
                failedCount = result.failed;
                for (const item of result.items) {
                    pendingSeenIds.delete(item.id);
                }
                set((state) =>
                    createNotificationStateFromSortedRows(
                        applyMarkSeenResults(state.rows, result.items),
                        state.detail
                    )
                );
                notificationRowsRevision += 1;
                syncShellUnseenCount(get().unseenCount);
                for (const item of result.items) {
                    if (item.state === 'failed') {
                        console.warn(
                            'Failed to mark VRChat notification as seen:',
                            item.message
                        );
                    }
                }
                if (failedCount > 0) {
                    await get().loadForCurrentUser();
                }
            } catch (error) {
                for (const id of ids) {
                    pendingSeenIds.delete(id);
                }
                await get()
                    .loadForCurrentUser()
                    .catch(() => {});
                throw error;
            } finally {
                for (const id of ids) {
                    pendingSeenIds.delete(id);
                }
            }
            if (failedCount > 0) {
                throw new Error(
                    `Failed to mark ${failedCount} notification(s) as seen.`
                );
            }
        },
        resetVrcNotificationState() {
            notificationScopeGeneration += 1;
            notificationRowsRevision += 1;
            set({
                rows: [],
                categories: createEmptyCategories(),
                unseenCount: 0,
                isCenterOpen: false,
                loadStatus: 'idle',
                detail: ''
            });
            syncShellUnseenCount(0);
        }
    })
);
