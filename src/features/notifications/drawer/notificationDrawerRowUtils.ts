import type { TFunction } from 'i18next';

import { formatDateFilter, formatRelativeTime } from '@/lib/dateTime';
import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';

export function getNotificationTypeLabel(
    notification: NotificationRow | null | undefined,
    t: TFunction
) {
    const type = notification?.type || 'unknown';
    return String(
        t(`view.notification.filters.${type}`, {
            defaultValue: type
        })
    );
}

export function getNotificationAbsoluteTime(
    notification: NotificationRow | null | undefined
) {
    const timestamp = notification?.createdAt || notification?.created_at;
    if (!timestamp) {
        return '';
    }
    const formatted = formatDateFilter(timestamp, 'long');
    return formatted === '-' ? '' : formatted;
}

export function getNotificationRelativeTime(
    notification: NotificationRow | null | undefined
) {
    const timestamp = notification?.createdAt || notification?.created_at;
    if (!timestamp) {
        return '';
    }
    return formatRelativeTime(timestamp);
}

export function getHoverTitle(
    notification: NotificationRow | null | undefined
) {
    return notification?.data?.announcementTitle || notification?.title || '';
}

export function getFriendMessage(
    notification: NotificationRow | null | undefined
) {
    return (
        notification?.message ||
        notification?.details?.inviteMessage ||
        notification?.details?.requestMessage ||
        notification?.details?.responseMessage ||
        ''
    );
}

export function isGroupNotification(
    notification: NotificationRow | null | undefined
) {
    return (
        hasGroupIdPrefix(String(notification?.senderUserId || '')) ||
        notification?.type?.startsWith('group.') ||
        notification?.type === 'groupChange'
    );
}

export function isFriendNotification(
    notification: NotificationRow | null | undefined
) {
    return [
        'invite',
        'requestInvite',
        'inviteResponse',
        'requestInviteResponse',
        'friendRequest',
        'ignoredFriendRequest',
        'boop'
    ].includes(String(notification?.type || ''));
}

export function computeRemaining(expiresAt: string | null | undefined) {
    if (!expiresAt) {
        return null;
    }
    const ts = Date.parse(expiresAt);
    if (!Number.isFinite(ts)) {
        return null;
    }
    return Math.max(0, ts - Date.now());
}

export function formatCountdown(ms: number) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
