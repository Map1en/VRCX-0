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
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

const pendingSeenIds = new Set<string>();

export type LoadStatus = 'idle' | 'running' | 'ready' | 'error';
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

function normalizeNotificationId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeNotificationIds(value: unknown | unknown[]): string[] {
    return (Array.isArray(value) ? value : [value])
        .map((entry) => normalizeNotificationId(entry))
        .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
type VrcNotificationStore = {
    rows: NotificationRow[];
    categories: NotificationCategories;
    unseenCount: number;
    isCenterOpen: boolean;
    loadStatus: LoadStatus;
    detail: string;
    loadForCurrentUser(): Promise<NotificationRow[]>;
    refreshForCurrentUser(): Promise<NotificationRow[]>;
    setCenterOpen(isCenterOpen: unknown): void;
    openCenter(): void;
    upsertNotification(notification: NotificationRow): void;
    patchNotification(id: unknown, fields: NotificationPatch): void;
    expireNotifications(ids: unknown | unknown[]): void;
    markNotificationsSeen(ids: unknown | unknown[]): void;
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

function buildCategories(rows: NotificationRow[]): NotificationCategories {
    const categories = createEmptyCategories();
    const recentCutoff = Date.now() - RECENT_WINDOW_MS;

    for (const notification of rows) {
        const category = getNotificationCategory(
            String(notification?.type || '')
        );
        const bucket = categories[category] || categories.other;
        if (isUnseenNotification(notification)) {
            bucket.unseen.push(notification);
            continue;
        }
        if (
            !isNotificationExpired(notification) &&
            getNotificationTs(notification) > recentCutoff
        ) {
            bucket.recent.push(notification);
        }
    }

    for (const bucket of Object.values(categories)) {
        bucket.unseen.sort(
            (left, right) => getNotificationTs(right) - getNotificationTs(left)
        );
        bucket.recent.sort(
            (left, right) => getNotificationTs(right) - getNotificationTs(left)
        );
    }

    return categories;
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

function createNotificationState(
    rows: NotificationRow[],
    detail = '',
    capacity = Number.POSITIVE_INFINITY
): NotificationStateSnapshot {
    const sortedRows = sortRows(rows);
    const cappedRows =
        sortedRows.length > capacity
            ? sortedRows.slice(0, capacity)
            : sortedRows;
    return {
        rows: cappedRows,
        categories: buildCategories(cappedRows),
        unseenCount: getUnseenRows(cappedRows).length,
        detail
    };
}

function getCurrentAuth(): RuntimeAuthSnapshot {
    return (useRuntimeStore.getState().auth || {}) as RuntimeAuthSnapshot;
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
    const effects = new Map(
        results.flatMap((result) =>
            result.state === 'succeeded' && result.effect
                ? [[result.id, result.effect] as const]
                : []
        )
    );
    if (!effects.size) {
        return rows;
    }
    return rows.map((row) => {
        const effect = row.id ? effects.get(row.id) : undefined;
        if (effect === 'seen') {
            return { ...row, seen: true };
        }
        if (effect === 'expired') {
            return {
                ...row,
                $isExpired: true,
                expired: true,
                seen: false
            };
        }
        return row;
    });
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

function syncShellUnseenCount(unseenCount: unknown) {
    useShellStore.getState().setVrcUnseenNotificationCount(unseenCount);
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
            const auth = getCurrentAuth();
            if (!auth.currentUserId) {
                set({
                    rows: [],
                    categories: createEmptyCategories(),
                    unseenCount: 0,
                    loadStatus: 'idle',
                    detail: 'No current user session is available.'
                });
                syncShellUnseenCount(0);
                return [];
            }

            set({ loadStatus: 'running', detail: '' });
            try {
                const rows = applyPendingSeenRows(
                    await notificationPersistenceRepository.queryNotifications({
                        userId: auth.currentUserId
                    })
                );
                set({
                    ...createNotificationState(rows),
                    loadStatus: 'ready'
                });
                syncShellUnseenCount(get().unseenCount);
                return rows;
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Failed to load VRChat notifications.';
                set({
                    rows: [],
                    categories: createEmptyCategories(),
                    unseenCount: 0,
                    loadStatus: 'error',
                    detail: message
                });
                syncShellUnseenCount(0);
                throw error;
            }
        },
        async refreshForCurrentUser() {
            const auth = getCurrentAuth();
            if (!auth.currentUserId) {
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
            const rows = await get().loadForCurrentUser();
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
        setCenterOpen(isCenterOpen: unknown) {
            const nextOpen = Boolean(isCenterOpen);
            set({ isCenterOpen: nextOpen });
            if (nextOpen) {
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
            syncShellUnseenCount(get().unseenCount);
        },
        patchNotification(id: unknown, fields: NotificationPatch) {
            const normalizedId = normalizeNotificationId(id);
            if (!normalizedId || !isRecord(fields)) {
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
                    ? createNotificationState(rows, state.detail)
                    : state;
            });
            syncShellUnseenCount(get().unseenCount);
        },
        expireNotifications(ids: unknown | unknown[]) {
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
                return createNotificationState(rows, state.detail);
            });
            syncShellUnseenCount(get().unseenCount);
        },
        markNotificationsSeen(ids: unknown | unknown[]) {
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
                return createNotificationState(rows, state.detail);
            });
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
                    createNotificationState(
                        applyMarkSeenResults(state.rows, result.items),
                        state.detail
                    )
                );
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
                    createNotificationState(
                        applyMarkSeenResults(state.rows, result.items),
                        state.detail
                    )
                );
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
