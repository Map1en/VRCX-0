import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from '@/services/toastService';
import { getNotificationLifecycleBucket } from '@/shared/utils/notificationLifecycle';
import {
    isNotificationExpired,
    isUnseenNotification
} from '@/shared/utils/notificationSeen';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import type {
    NotificationLoadStatus,
    NotificationRow
} from './notificationPageTypes';
import { filterNotificationRows } from './notificationRows';
import type { NotificationQuickFilter } from './useNotificationFilters';

export type NotificationQuickFilterCounts = Record<
    NotificationQuickFilter,
    number
>;

function notificationKey(notification: NotificationRow) {
    return typeof notification.id === 'string' ? notification.id : '';
}

function matchesQuickFilter(
    notification: NotificationRow,
    quickFilter: NotificationQuickFilter
): boolean {
    if (quickFilter === 'unread') {
        return isUnseenNotification(notification);
    }
    if (quickFilter === 'action') {
        return (
            getNotificationLifecycleBucket(notification.type) === 'action' &&
            !isNotificationExpired(notification)
        );
    }
    return true;
}

export function useNotificationRows({
    activeTypes,
    currentUserId,
    deferredSearchQuery,
    filtersReady,
    holdNew = false,
    quickFilter
}: {
    activeTypes: string[];
    currentUserId?: string;
    deferredSearchQuery: string;
    filtersReady: boolean;
    holdNew?: boolean;
    quickFilter: NotificationQuickFilter;
}) {
    const { t } = useTranslation();
    const notificationRows = useVrcNotificationStore((state) => state.rows);
    const notificationLoadStatus = useVrcNotificationStore(
        (state) => state.loadStatus
    );
    const notificationDetail = useVrcNotificationStore((state) => state.detail);
    const loadNotificationsForCurrentUser = useVrcNotificationStore(
        (state) => state.loadForCurrentUser
    );
    const [rows, setRows] = useState<NotificationRow[]>([]);
    const [loadStatus, setLoadStatus] =
        useState<NotificationLoadStatus>('idle');
    const [detail, setDetail] = useState('');
    const [reloadToken, setReloadToken] = useState(0);
    const [pendingCount, setPendingCount] = useState(0);
    const [quickFilterCounts, setQuickFilterCounts] =
        useState<NotificationQuickFilterCounts>({
            all: 0,
            action: 0,
            unread: 0
        });
    const heldRef = useRef<{ key: string; ids: Set<string> } | null>(null);

    const reload = useCallback(() => {
        setReloadToken((value) => value + 1);
    }, []);

    useEffect(() => {
        let active = true;
        if (!filtersReady) {
            return () => {
                active = false;
            };
        }
        if (!currentUserId) {
            setRows([]);
            setLoadStatus('idle');
            setDetail('No current user session is available.');
            return () => {
                active = false;
            };
        }
        loadNotificationsForCurrentUser().catch((error: unknown) => {
            if (!active) {
                return;
            }
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.notifications.toast.failed_to_load_notifications'
                          )
            });
        });
        return () => {
            active = false;
        };
    }, [
        currentUserId,
        filtersReady,
        loadNotificationsForCurrentUser,
        reloadToken,
        t
    ]);

    useEffect(() => {
        if (!filtersReady || !currentUserId) {
            return;
        }
        const typedRows = filterNotificationRows(
            notificationRows,
            activeTypes,
            deferredSearchQuery
        );
        const nextRows = typedRows.filter((notification) =>
            matchesQuickFilter(notification, quickFilter)
        );
        const holdKey = JSON.stringify([
            activeTypes,
            deferredSearchQuery,
            quickFilter
        ]);
        if (!holdNew) {
            heldRef.current = null;
        } else if (heldRef.current?.key !== holdKey) {
            heldRef.current = {
                key: holdKey,
                ids: new Set(nextRows.map(notificationKey))
            };
        }
        const held = heldRef.current;
        const visibleRows = held
            ? nextRows.filter((notification) =>
                  held.ids.has(notificationKey(notification))
              )
            : nextRows;
        setRows(visibleRows);
        setPendingCount(nextRows.length - visibleRows.length);
        setQuickFilterCounts({
            all: typedRows.length,
            action: typedRows.filter((notification) =>
                matchesQuickFilter(notification, 'action')
            ).length,
            unread: typedRows.filter((notification) =>
                matchesQuickFilter(notification, 'unread')
            ).length
        });
        setLoadStatus(notificationLoadStatus);
        setDetail(notificationDetail || '');
    }, [
        activeTypes,
        currentUserId,
        deferredSearchQuery,
        filtersReady,
        holdNew,
        notificationDetail,
        notificationLoadStatus,
        notificationRows,
        quickFilter
    ]);

    return {
        detail,
        loadStatus,
        pendingCount,
        quickFilterCounts,
        reload,
        rows
    };
}
