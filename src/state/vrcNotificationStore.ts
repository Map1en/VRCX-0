import { create } from 'zustand';

import type { LoadStatus } from '@/domain/shared/types';
import type { NotificationMarkSeenEffect } from '@/platform/tauri/bindings';
import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
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

export type { LoadStatus };
type NotificationCategoryKey = 'friend' | 'group' | 'other';
export type NotificationPatch = Partial<{
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
    setLoadState(loadStatus: LoadStatus, detail: string): void;
    setLoadedRows(rows: NotificationRow[]): void;
    clearRows(loadStatus: LoadStatus, detail: string): void;
    setCenterOpen(isCenterOpen: boolean): void;
    upsertNotification(notification: NotificationRow): void;
    patchNotification(id: string, fields: NotificationPatch): void;
    expireNotifications(ids: ReadonlySet<string>): void;
    markNotificationsSeen(ids: ReadonlySet<string>): void;
    applyReadEffects(
        effects: ReadonlyMap<string, NotificationMarkSeenEffect>
    ): void;
    flagReadFailure(id: string): void;
    startMarkAllSeen(progress: MarkAllSeenProgress): void;
    updateMarkAllSeenProgress(
        update: (progress: MarkAllSeenProgress) => MarkAllSeenProgress
    ): void;
    finishMarkAllSeen(failedIds: string[]): void;
    reset(): void;
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

export function isRecentDismissible(
    notification: NotificationRow,
    recentCutoff: number
): boolean {
    return (
        !isUnseenNotification(notification) &&
        isRecentNotification(notification, recentCutoff) &&
        getDismissResponse(notification.responses) !== null
    );
}

export function isPendingInvite(notification: NotificationRow): boolean {
    return (
        isInviteNotificationType(notification.type) &&
        !isNotificationExpired(notification)
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

export function mergeLoadedNotificationRows(
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

export function applyReadEffects(
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

function withoutFailedIds(
    failedIds: string[],
    idSet: ReadonlySet<string>
): string[] {
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

export const useVrcNotificationStore = create<VrcNotificationStore>((set) => ({
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
    setLoadState(loadStatus, detail) {
        set({ loadStatus, detail });
    },
    setLoadedRows(rows) {
        set({
            ...createNotificationState(rows),
            loadStatus: 'ready'
        });
    },
    clearRows(loadStatus, detail) {
        set({
            rows: [],
            categories: createEmptyCategories(),
            unseenCount: 0,
            pendingInviteCount: 0,
            recentDismissibleCount: 0,
            loadStatus,
            detail
        });
    },
    setCenterOpen(isCenterOpen) {
        set({ isCenterOpen });
    },
    upsertNotification(notification) {
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
    },
    patchNotification(id, fields) {
        set((state) => {
            let changed = false;
            const rows = state.rows.map((row: NotificationRow) => {
                if (row.id !== id) {
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
    },
    expireNotifications(idSet) {
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
                ...createNotificationStateFromSortedRows(rows, state.detail),
                markAllSeenFailedIds: withoutFailedIds(
                    state.markAllSeenFailedIds,
                    idSet
                )
            };
        });
    },
    markNotificationsSeen(idSet) {
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
                ...createNotificationStateFromSortedRows(rows, state.detail),
                markAllSeenFailedIds: withoutFailedIds(
                    state.markAllSeenFailedIds,
                    idSet
                )
            };
        });
    },
    applyReadEffects(effects) {
        const idSet = new Set(effects.keys());
        set((state) => ({
            ...createNotificationStateFromSortedRows(
                applyReadEffects(state.rows, effects),
                state.detail
            ),
            markAllSeenFailedIds: withoutFailedIds(
                state.markAllSeenFailedIds,
                idSet
            )
        }));
    },
    flagReadFailure(id) {
        set((state) => ({
            markAllSeenFailedIds: [
                ...withoutFailedIds(state.markAllSeenFailedIds, new Set([id])),
                id
            ]
        }));
    },
    startMarkAllSeen(progress) {
        set({
            markAllSeenProgress: progress,
            markAllSeenFailedIds: []
        });
    },
    updateMarkAllSeenProgress(update) {
        set((state) =>
            state.markAllSeenProgress
                ? {
                      markAllSeenProgress: update(state.markAllSeenProgress)
                  }
                : state
        );
    },
    finishMarkAllSeen(failedIds) {
        set({
            markAllSeenProgress: null,
            markAllSeenFailedIds: failedIds
        });
    },
    reset() {
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
    }
}));
