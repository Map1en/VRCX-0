import { create } from 'zustand';

import { notificationRepository } from '@/repositories/index.js';
import { getNotificationCategory, getNotificationTs } from '@/shared/utils/notificationCategory.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const pendingSeenIds = new Set();

function isNotificationExpired(notification) {
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

function isUnseenNotification(notification) {
    return notification?.version === 2 && notification.seen === false && !isNotificationExpired(notification);
}

function createEmptyCategories() {
    return {
        friend: { unseen: [], recent: [] },
        group: { unseen: [], recent: [] },
        other: { unseen: [], recent: [] }
    };
}

function buildCategories(rows) {
    const categories = createEmptyCategories();
    const recentCutoff = Date.now() - RECENT_WINDOW_MS;

    for (const notification of Array.isArray(rows) ? rows : []) {
        const category = getNotificationCategory(notification?.type);
        const bucket = categories[category] || categories.other;
        if (isUnseenNotification(notification)) {
            bucket.unseen.push(notification);
            continue;
        }
        if (!isNotificationExpired(notification) && getNotificationTs(notification) > recentCutoff) {
            bucket.recent.push(notification);
        }
    }

    for (const bucket of Object.values(categories)) {
        bucket.unseen.sort((left, right) => getNotificationTs(right) - getNotificationTs(left));
        bucket.recent.sort((left, right) => getNotificationTs(right) - getNotificationTs(left));
    }

    return categories;
}

function sortRows(rows) {
    return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
        const leftTime = getNotificationTs(left);
        const rightTime = getNotificationTs(right);
        if (leftTime !== rightTime) {
            return rightTime - leftTime;
        }
        return String(right?.id || '').localeCompare(String(left?.id || ''));
    });
}

function createNotificationState(rows, detail = '') {
    const sortedRows = sortRows(rows);
    return {
        rows: sortedRows,
        categories: buildCategories(sortedRows),
        unseenCount: getUnseenRows(sortedRows).length,
        detail
    };
}

function getCurrentAuth() {
    return useRuntimeStore.getState().auth || {};
}

function getUnseenRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(isUnseenNotification);
}

function applyPendingSeenRows(rows) {
    if (!pendingSeenIds.size) {
        return rows;
    }
    return rows.map((row) =>
        pendingSeenIds.has(row.id)
            ? {
                ...row,
                seen: true
            }
            : row
    );
}

function delay(ms) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function syncShellUnseenCount(unseenCount) {
    useShellStore.getState().setVrcUnseenNotificationCount(unseenCount);
}

export const useVrcNotificationStore = create((set, get) => ({
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
            const rows = applyPendingSeenRows(await notificationRepository.queryNotifications({
                userId: auth.currentUserId
            }));
            set({
                ...createNotificationState(rows, `${rows.length} VRChat notifications loaded.`),
                loadStatus: 'ready',
            });
            syncShellUnseenCount(get().unseenCount);
            return rows;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to load VRChat notifications.';
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
    setCenterOpen(isCenterOpen) {
        const nextOpen = Boolean(isCenterOpen);
        set({ isCenterOpen: nextOpen });
        if (nextOpen) {
            void get().loadForCurrentUser().catch(() => {});
        }
    },
    openCenter() {
        get().setCenterOpen(true);
    },
    upsertNotification(notification) {
        if (!notification?.id) {
            return;
        }
        set((state) => {
            const existing = state.rows.find((row) => row.id === notification.id) || {};
            const rows = [
                { ...existing, ...notification },
                ...state.rows.filter((row) => row.id !== notification.id)
            ];
            return createNotificationState(rows, state.detail);
        });
        syncShellUnseenCount(get().unseenCount);
    },
    expireNotifications(ids) {
        const idSet = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean));
        if (!idSet.size) {
            return;
        }
        const expiresAt = new Date().toISOString();
        set((state) =>
            createNotificationState(
                state.rows.map((row) =>
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
    markNotificationsSeen(ids) {
        const idSet = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean));
        if (!idSet.size) {
            return;
        }
        set((state) =>
            createNotificationState(
                state.rows.map((row) =>
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
    async markNotificationSeen(notification) {
        const auth = getCurrentAuth();
        if (!auth.currentUserId || !notification?.id || !isUnseenNotification(notification)) {
            return;
        }
        await notificationRepository.markSeen({
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

        const ids = unseenRows.map((notification) => notification.id).filter(Boolean);
        const localV2Ids = unseenRows
            .filter((notification) => Number(notification.version) === 2)
            .map((notification) => notification.id)
            .filter(Boolean);
        for (const id of ids) {
            pendingSeenIds.add(id);
        }
        get().markNotificationsSeen(ids);
        try {
            await notificationRepository.markSeenLocalBulk({
                userId: auth.currentUserId,
                ids: localV2Ids
            });
            for (const notification of unseenRows) {
                await notificationRepository.markSeen({
                    userId: auth.currentUserId,
                    id: notification.id,
                    version: notification.version,
                    endpoint: auth.currentUserEndpoint
                })
                    .catch((error) => {
                        console.warn('Failed to mark VRChat notification as seen:', error);
                    });
                await delay(250);
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
}));
