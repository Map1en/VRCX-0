import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import type { NotificationRow } from './notificationPageTypes';
import { filterNotificationRows } from './notificationRows';

export function useNotificationRows({
    activeTypes,
    currentUserId,
    deferredSearchQuery,
    filtersReady
}: {
    activeTypes: string[];
    currentUserId?: string;
    deferredSearchQuery: string;
    filtersReady: boolean;
}) {
    const { t } = useTranslation();
    const notificationRows = useVrcNotificationStore(
        (state: any) => state.rows
    );
    const notificationLoadStatus = useVrcNotificationStore(
        (state: any) => state.loadStatus
    );
    const notificationDetail = useVrcNotificationStore(
        (state: any) => state.detail
    );
    const loadNotificationsForCurrentUser = useVrcNotificationStore(
        (state: any) => state.loadForCurrentUser
    );
    const [rows, setRows] = useState<NotificationRow[]>([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [reloadToken, setReloadToken] = useState(0);

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
        loadNotificationsForCurrentUser().catch((error: any) => {
            if (!active) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.notifications.toast.failed_to_load_notifications')
            );
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
        const nextRows = filterNotificationRows(
            notificationRows,
            activeTypes,
            deferredSearchQuery
        );
        setRows(nextRows);
        setLoadStatus(notificationLoadStatus);
        setDetail(notificationDetail || '');
    }, [
        activeTypes,
        currentUserId,
        deferredSearchQuery,
        filtersReady,
        notificationDetail,
        notificationLoadStatus,
        notificationRows
    ]);

    return {
        detail,
        loadStatus,
        reload,
        rows
    };
}
