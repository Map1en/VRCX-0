import { create } from 'zustand';

import notificationPersistenceRepository from '@/repositories/notificationPersistenceRepository';
import { windowDelay } from '@/shared/utils/delays';
import {
    getNotificationCategory,
    getNotificationTs
} from '@/shared/utils/notificationCategory';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_V1_UNSEEN_TYPES = new Set(['friendRequest']);
const ACTION_REQUIRED_V1_TYPES = new Set(['friendRequest']);
const pendingSeenIds = new Set<unknown>();

type LoadStatus = 'idle' | 'running' | 'ready' | 'error';
type NotificationCategoryKey = 'friend' | 'group' | 'other';
type NotificationRow = Record<string, unknown> & {
    id?: string;
    version?: number;
    seen?: boolean;
    expired?: boolean;
    $isExpired?: boolean;
    expiresAt?: string;
    created_at?: string | number | null;
    createdAt?: string | number | null;
    type?: string;
};
type NotificationPatch = Partial<{
    displayName: string;
    senderDisplayName: string;
    senderUsername: string;
    worldName: string;
    displayLocation: string;
}>;
type NotificationBucket = {
    unseen: NotificationRow[];
    recent: NotificationRow[];
};
const NOTIFICATION_DETAILS_PATCH_KEYS = [
    'worldName',
    'displayLocation'
] as const;

function normalizeNotificationId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function nonEmptyNotificationPatch(
    fields: NotificationPatch
): NotificationPatch {
    return Object.fromEntries(
        Object.entries(fields).filter(
            ([, value]) => typeof value === 'string' && value.trim() !== ''
        )
    ) as NotificationPatch;
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

type NotificationCategories = Record<
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
    return !(version !== 2 && ACTION_REQUIRED_V1_TYPES.has(type));
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

    for (const notification of Array.isArray(rows) ? rows : []) {
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
            (left: any, right: any) =>
                getNotificationTs(right) - getNotificationTs(left)
        );
        bucket.recent.sort(
            (left: any, right: any) =>
                getNotificationTs(right) - getNotificationTs(left)
        );
    }

    return categories;
}

function sortRows(rows: unknown): NotificationRow[] {
    return [...(Array.isArray(rows) ? rows : [])].sort(
        (left: any, right: any) => {
            const leftTime = getNotificationTs(left);
            const rightTime = getNotificationTs(right);
            if (leftTime !== rightTime) {
                return rightTime - leftTime;
            }
            return String(right?.id || '').localeCompare(
                String(left?.id || '')
            );
        }
    );
}

function createNotificationState(rows: unknown, detail: any = '') {
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

function getUnseenRows(rows: unknown): NotificationRow[] {
    return (Array.isArray(rows) ? rows : []).filter(isUnseenNotification);
}

function applyPendingSeenRows(rows: NotificationRow[]): NotificationRow[] {
    if (!pendingSeenIds.size) {
        return rows;
    }
    return rows.map((row: any) =>
        pendingSeenIds.has(row.id)
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
    (set: any, get: any) => ({
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
        setCenterOpen(isCenterOpen: any) {
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
        upsertNotification(notification: any) {
            if (!notification?.id) {
                return;
            }
            set((state: any) => {
                const existing =
                    state.rows.find((row: any) => row.id === notification.id) ||
                    {};
                const rows = [
                    { ...existing, ...notification },
                    ...state.rows.filter(
                        (row: any) => row.id !== notification.id
                    )
                ];
                return createNotificationState(rows, state.detail);
            });
            syncShellUnseenCount(get().unseenCount);
        },
        patchNotification(id: any, fields: any) {
            const normalizedId = normalizeNotificationId(id);
            if (!normalizedId || !fields || typeof fields !== 'object') {
                return;
            }
            set((state: any) => {
                let changed = false;
                const rows = state.rows.map((row: NotificationRow) => {
                    if (row.id !== normalizedId) {
                        return row;
                    }
                    const patch = nonEmptyNotificationPatch(fields);
                    if (!Object.keys(patch).length) {
                        return row;
                    }
                    const details =
                        row.details && typeof row.details === 'object'
                            ? (row.details as Record<string, unknown>)
                            : {};
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
        expireNotifications(ids: any) {
            const idSet = new Set(
                (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
            );
            if (!idSet.size) {
                return;
            }
            const expiresAt = new Date().toISOString();
            set((state: any) =>
                createNotificationState(
                    state.rows.map((row: any) =>
                        idSet.has(row.id)
                            ? {
                                  ...row,
                                  expiresAt,
                                  expired: true,
                                  seen: true
                              }
                            : row
                    ),
                    state.detail
                )
            );
            syncShellUnseenCount(get().unseenCount);
        },
        markNotificationsSeen(ids: any) {
            const idSet = new Set(
                (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
            );
            if (!idSet.size) {
                return;
            }
            set((state: any) =>
                createNotificationState(
                    state.rows.map((row: any) =>
                        idSet.has(row.id)
                            ? {
                                  ...row,
                                  seen: true
                              }
                            : row
                    ),
                    state.detail
                )
            );
            syncShellUnseenCount(get().unseenCount);
        },
        async markNotificationSeen(notification: any) {
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
                .map((notification: any) => notification.id)
                .filter(Boolean);
            if (!ids.length) {
                return;
            }
            const localV2Ids = markableRows
                .filter(
                    (notification: any) => Number(notification.version) === 2
                )
                .map((notification: any) => notification.id)
                .filter(Boolean);
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
                        .catch((error: any) => {
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
