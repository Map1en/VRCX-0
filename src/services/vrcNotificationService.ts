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
    setShellVrcUnseenNotificationCount,
    syncShellNotificationDot
} from '@/services/shellNotificationDotService';
import { getDismissResponse } from '@/shared/utils/notificationResponse';
import {
    isUnseenNotification,
    RECENT_WINDOW_MS
} from '@/shared/utils/notificationSeen';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    applyReadEffects,
    isPendingInvite,
    isRecentDismissible,
    type MarkAllSeenProgress,
    type MarkAllSeenResult,
    type MarkNotificationReadResult,
    mergeLoadedNotificationRows,
    type NotificationPatch,
    useVrcNotificationStore
} from '@/state/vrcNotificationStore';

const pendingReadEffects = new Map<string, NotificationMarkSeenEffect>();
let notificationScopeGeneration = 0;
let notificationRowsRevision = 0;

type RuntimeAuthSnapshot = {
    currentUserId?: string | null;
    currentUserEndpoint?: string;
};
type NotificationOperationScope = {
    currentUserId: string;
    currentUserEndpoint: string;
    generation: number;
};

function normalizeNotificationId(value: string | null | undefined): string {
    return value?.trim() ?? '';
}

function normalizeNotificationIds(value: string | string[]): string[] {
    return (Array.isArray(value) ? value : [value])
        .map((entry) => normalizeNotificationId(entry))
        .filter(Boolean);
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

function syncShellUnseenCount(unseenCount: number, force = false) {
    setShellVrcUnseenNotificationCount(unseenCount);
    if (force) {
        syncShellNotificationDot(true);
    }
}

function syncRowsChanged() {
    notificationRowsRevision += 1;
    syncShellUnseenCount(useVrcNotificationStore.getState().unseenCount);
}

function applyReadEffectsToStore(
    effects: ReadonlyMap<string, NotificationMarkSeenEffect>
) {
    useVrcNotificationStore.getState().applyReadEffects(effects);
    syncRowsChanged();
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
            await loadVrcNotificationsForCurrentUser().catch(() => {});
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

export async function loadVrcNotificationsForCurrentUser(): Promise<
    NotificationRow[]
> {
    const store = useVrcNotificationStore.getState();
    const scope = captureNotificationScope();
    if (!scope) {
        store.clearRows(
            'idle',
            i18n.t('view.notifications.toast.no_current_user_session')
        );
        notificationRowsRevision += 1;
        syncShellUnseenCount(0, true);
        return [];
    }

    store.setLoadState('running', '');
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
            rows = mergeLoadedNotificationRows(
                rows,
                useVrcNotificationStore.getState().rows
            );
        }
        store.setLoadedRows(rows);
        notificationRowsRevision += 1;
        syncShellUnseenCount(
            useVrcNotificationStore.getState().unseenCount,
            true
        );
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
            store.setLoadState('error', message);
            syncShellUnseenCount(
                useVrcNotificationStore.getState().unseenCount,
                true
            );
            throw error;
        }
        store.clearRows('error', message);
        notificationRowsRevision += 1;
        syncShellUnseenCount(0, true);
        throw error;
    }
}

export async function refreshVrcNotificationsForCurrentUser(): Promise<
    NotificationRow[]
> {
    const scope = captureNotificationScope();
    if (!scope) {
        return loadVrcNotificationsForCurrentUser();
    }
    useVrcNotificationStore.getState().setLoadState('running', '');
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
    const rows = await loadVrcNotificationsForCurrentUser();
    if (!isCurrentNotificationScope(scope)) {
        return rows;
    }
    if (syncFailed) {
        useVrcNotificationStore
            .getState()
            .setLoadState(
                'error',
                syncError instanceof Error
                    ? syncError.message
                    : 'Failed to refresh VRChat notifications.'
            );
        throw syncError;
    }
    return rows;
}

export function setVrcNotificationCenterOpen(isCenterOpen: boolean): void {
    useVrcNotificationStore.getState().setCenterOpen(isCenterOpen);
    if (isCenterOpen) {
        refreshVrcNotificationsForCurrentUser().catch(() => {});
    }
}

export function openVrcNotificationCenter(): void {
    setVrcNotificationCenterOpen(true);
}

export function upsertVrcNotification(notification: NotificationRow): void {
    if (!notification?.id) {
        return;
    }
    useVrcNotificationStore.getState().upsertNotification(notification);
    syncRowsChanged();
}

export function patchVrcNotification(
    id: string,
    fields: NotificationPatch
): void {
    const normalizedId = normalizeNotificationId(id);
    if (!normalizedId) {
        return;
    }
    useVrcNotificationStore.getState().patchNotification(normalizedId, fields);
    syncRowsChanged();
}

export function expireVrcNotifications(ids: string | string[]): void {
    const idSet = new Set(normalizeNotificationIds(ids));
    if (!idSet.size) {
        return;
    }
    useVrcNotificationStore.getState().expireNotifications(idSet);
    syncRowsChanged();
}

export function markVrcNotificationsSeen(ids: string | string[]): void {
    const idSet = new Set(normalizeNotificationIds(ids));
    if (!idSet.size) {
        return;
    }
    useVrcNotificationStore.getState().markNotificationsSeen(idSet);
    syncRowsChanged();
}

export async function markVrcNotificationRead(
    notification?: NotificationRow | null
): Promise<MarkNotificationReadResult> {
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
    const effects = new Map([[item.id, optimisticReadEffect(notification)]]);
    const result = await runMarkReadBatch(scope, [item], effects);
    const failed = result.items.find(
        (resultItem) => resultItem.state === 'remoteFailed'
    );
    if (failed && isCurrentNotificationScope(scope)) {
        useVrcNotificationStore.getState().flagReadFailure(failed.id);
    }
    return {
        remoteFailed: Boolean(failed),
        message: failed?.message || ''
    };
}

export async function markAllVrcNotificationsSeen(): Promise<MarkAllSeenResult> {
    const store = useVrcNotificationStore.getState();
    const scope = captureNotificationScope();
    const recentCutoff = Date.now() - RECENT_WINDOW_MS;
    const targetRows = store.rows.filter(
        (notification) =>
            canMarkNotificationRead(notification) ||
            isRecentDismissible(notification, recentCutoff)
    );
    if (!scope || store.markAllSeenProgress || !targetRows.length) {
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
        store.updateMarkAllSeenProgress(update);
    };
    store.startMarkAllSeen({
        total: readBatch.items.length + dismissIds.length,
        done: 0,
        activeId: '',
        queuedIds: dismissIds
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
                    expireVrcNotifications(id);
                }
            } catch (error) {
                if (isUnseenNotification(target.notification)) {
                    failedDismissRows.push(target.notification);
                } else {
                    failedIds.push(id);
                }
                console.warn('Failed to dismiss VRChat notification:', error);
            }
            updateProgress((progress) => ({
                ...progress,
                activeId: '',
                done: progress.done + 1
            }));
        }

        const fallbackBatch = toMarkReadBatch(failedDismissRows);
        if (fallbackBatch.items.length && isCurrentNotificationScope(scope)) {
            const result = await runMarkReadBatch(
                scope,
                fallbackBatch.items,
                fallbackBatch.effects
            );
            collectRemoteFailures(result.items);
        }

        if (isCurrentNotificationScope(scope) && dismissIds.length) {
            await loadVrcNotificationsForCurrentUser();
        }
    } finally {
        if (isCurrentNotificationScope(scope)) {
            store.finishMarkAllSeen(failedIds);
        }
    }
    return { failedCount: failedIds.length };
}

export function resetVrcNotificationState(): void {
    notificationScopeGeneration += 1;
    notificationRowsRevision += 1;
    useVrcNotificationStore.getState().reset();
    syncShellUnseenCount(0);
}
