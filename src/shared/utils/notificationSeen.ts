import { DAY_MS } from '@/shared/constants/time';

import { getNotificationLifecycleBucket } from './notificationLifecycle';

export const RECENT_WINDOW_MS = DAY_MS;
const ACTION_REQUIRED_V1_TYPES = new Set<string>(['friendRequest']);

export type NotificationSeenLike = {
    $isExpired?: boolean;
    createdAt?: string | number | null;
    created_at?: string | number | null;
    expired?: boolean;
    expiresAt?: string | null;
    seen?: boolean;
    type?: string;
    version?: number;
};

export function isNotificationExpired(
    notification?: NotificationSeenLike | null
): boolean {
    if (notification?.$isExpired !== undefined) {
        return notification.$isExpired;
    }
    if (notification?.expired !== undefined) {
        return notification.expired;
    }
    if (!notification?.expiresAt) {
        return false;
    }
    const expiresAt = Date.parse(notification.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export function isUnseenNotification(
    notification?: NotificationSeenLike | null
): boolean {
    if (!notification) {
        return false;
    }
    const version = notification.version ?? 1;
    const type = notification.type ?? '';
    const isActionRequiredV1 =
        version !== 2 && ACTION_REQUIRED_V1_TYPES.has(type);
    return (
        (version === 2 || isActionRequiredV1) &&
        notification.seen === false &&
        !isNotificationExpired(notification)
    );
}

export function shouldMarkSeenRemotely(
    notification?: NotificationSeenLike | null
): boolean {
    return getNotificationLifecycleBucket(notification?.type) !== 'system';
}
