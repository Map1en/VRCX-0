import { createContext, useContext, useEffect, useState } from 'react';

import { isUnseenNotification } from '@/shared/utils/notificationSeen';

import type { NotificationRow } from './notificationPageTypes';

export const NotificationSessionUnreadContext = createContext<
    ReadonlySet<string>
>(new Set());

function notificationKey(notification: NotificationRow) {
    return typeof notification.id === 'string' ? notification.id : '';
}

export function useSessionUnreadKeys(rows: readonly NotificationRow[]) {
    const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());

    useEffect(() => {
        setKeys((current) => {
            let next: Set<string> | null = null;
            for (const row of rows) {
                const key = notificationKey(row);
                if (!key || current.has(key) || !isUnseenNotification(row)) {
                    continue;
                }
                next ??= new Set(current);
                next.add(key);
            }
            return next ?? current;
        });
    }, [rows]);

    return keys;
}

export function useNotificationNewThisSession(notification: NotificationRow) {
    const keys = useContext(NotificationSessionUnreadContext);
    const key = notificationKey(notification);
    return Boolean(key) && keys.has(key);
}
