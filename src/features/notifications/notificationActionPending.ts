import { createContext, useContext } from 'react';

import type { NotificationRow } from './notificationPageTypes';

export const NotificationActionPendingContext = createContext<
    ReadonlySet<string>
>(new Set());

export function getNotificationActionKey(notification: NotificationRow) {
    return typeof notification.id === 'string' ? notification.id : '';
}

export function useNotificationActionPending(notification: NotificationRow) {
    const pendingKeys = useContext(NotificationActionPendingContext);
    const key = getNotificationActionKey(notification);
    return Boolean(key) && pendingKeys.has(key);
}
