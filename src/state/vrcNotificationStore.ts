import { create } from 'zustand';

import notificationPersistenceRepository from '@/repositories/notificationPersistenceRepository';
import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import { DAY_MS } from '@/shared/constants/time';
import { windowDelay } from '@/shared/utils/delays';
import {
    getNotificationCategory,
    getNotificationTs
} from '@/shared/utils/notificationCategory';
import { getNotificationLifecycleBucket } from '@/shared/utils/notificationLifecycle';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

const RECENT_WINDOW_MS = DAY_MS;
const TRANSIENT_V1_UNSEEN_TYPES = new Set(['friendRequest']);
const ACTION_REQUIRED_V1_TYPES = new Set(['friendRequest']);
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

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '';
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

function isNotificationExpired(notification?: NotificationRow | null): boolean {
    if (notification?.$isExpired !== undefined) {
        return Boolean(notification.$isExpired);
    }
    if (notification?.expired !== undefined) {
        return Boolean(notification.expired);
    }
    if (!notification?.expiresAt) {
        return false;
    }
    const expiresAt = Date.parse(notification.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function isUnseenNotification(notification?: NotificationRow | null): boolean {
    if (!notification) {
        return false;
    }
    const version = Number(notification?.version ?? 1);
    const type = String(notification?.type || '');
    const isTransientV1Unseen =
        version !== 2 &&
        TRANSIENT_V1_UNSEEN_TYPES.has(type) &&
        getNotificationTs(notification) > Date.now() - RECENT_WINDOW_MS;
    return (
        (version === 2 || isTransientV1Unseen) &&
        notification.seen === false &&
        !isNotificationExpired(notification)
    );
}

function shouldMarkSeenOnCenterClose(
    notification?: NotificationRow | null
): boolean {
    const version = Number(notification?.version ?? 1);
    const type = String(notification?.type || '');
    return (
        getNotificationLifecycleBucket(type) !== 'system' &&
        !(version !== 2 && ACTION_REQUIRED_V1_TYPES.has(type))
    );
}

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
    detail = ''
): NotificationStateSnapshot {
    const sortedRows = sortRows(rows);
    return {
        rows: sortedRows,
        categories: buildCategories(sortedRows),
        unseenCount: getUnseenRows(sortedRows).length,
        detail
    };
}

function getCurrentAuth(): RuntimeAuthSnapshot {
    return (useRuntimeStore.getState().auth || {}) as RuntimeAuthSnapshot;
}

function getUnseenRows(rows: NotificationRow[]): NotificationRow[] {
    return rows.filter(isUnseenNotification);
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
        setCenterOpen(isCenterOpen: unknown) {
            const nextOpen = Boolean(isCenterOpen);
            set({ isCenterOpen: nextOpen });
            if (nextOpen) {
                get()
                    .loadForCurrentUser()
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
                const rows = [
                    { ...existing, ...notification },
                    ...state.rows.filter((row) => row.id !== notification.id)
                ];
                return createNotificationState(rows, state.detail);
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
            if (
                !auth.currentUserId ||
                !notification?.id ||
                !isUnseenNotification(notification)
            ) {
                return;
            }
            await notificationPersistenceRepository.markSeen({
                userId: auth.currentUserId,
                id: notification.id,
                version: notification.version,
                endpoint: auth.currentUserEndpoint
            });
            get().markNotificationsSeen(notification.id);
            await get().loadForCurrentUser();
        },
        async markAllSeen() {
            const auth = getCurrentAuth();
            const unseenRows = getUnseenRows(get().rows);
            if (!auth.currentUserId || !unseenRows.length) {
                return;
            }

            const markableRows = unseenRows.filter(shouldMarkSeenOnCenterClose);
            const ids = markableRows
                .map((notification) => notification.id)
                .filter(isNonEmptyString);
            if (!ids.length) {
                return;
            }
            const localV2Ids = markableRows
                .filter((notification) => Number(notification.version) === 2)
                .map((notification) => notification.id)
                .filter(isNonEmptyString);
            for (const id of ids) {
                pendingSeenIds.add(id);
            }
            get().markNotificationsSeen(ids);
            try {
                await notificationPersistenceRepository.markSeenLocalBulk({
                    userId: auth.currentUserId,
                    ids: localV2Ids
                });
                for (const notification of markableRows) {
                    await notificationPersistenceRepository
                        .markSeen({
                            userId: auth.currentUserId,
                            id: notification.id,
                            version: notification.version,
                            endpoint: auth.currentUserEndpoint
                        })
                        .catch((error: unknown) => {
                            console.warn(
                                'Failed to mark VRChat notification as seen:',
                                error
                            );
                        });
                    await windowDelay(250);
                }
                await get().loadForCurrentUser();
            } finally {
                for (const id of ids) {
                    pendingSeenIds.delete(id);
                }
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
