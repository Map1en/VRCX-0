import type { TFunction } from 'i18next';
import {
    BanIcon,
    BellIcon,
    BellOffIcon,
    CalendarIcon,
    CheckIcon,
    GlobeIcon,
    LinkIcon,
    MessageCircleIcon,
    ReplyIcon,
    SendIcon,
    ShieldIcon,
    TagIcon,
    UsersIcon,
    XIcon,
    type LucideIcon
} from 'lucide-react';

import {
    canDeclineNotification,
    getResponseLabel,
    isNotificationExpired
} from '@/components/hosts/vrc-notification-center/notificationCenterUtils';
import { formatDateFilter, formatRelativeTime } from '@/lib/dateTime';
import type {
    NotificationResponse,
    NotificationRow
} from '@/repositories/notificationPersistenceRepository';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';

import type { NotificationDrawerHandlers } from './NotificationDrawerList';

const PERSON_TYPES = new Set<string>([
    'friendRequest',
    'ignoredFriendRequest',
    'invite',
    'requestInvite',
    'inviteResponse',
    'requestInviteResponse',
    'boop',
    'message'
]);

type NotificationDrawerAction = {
    Icon: LucideIcon;
    key: string;
    label: string;
    onClick: () => void;
};

export function usesAvatar(notification: NotificationRow | null | undefined) {
    return (
        PERSON_TYPES.has(String(notification?.type || '')) &&
        !hasGroupIdPrefix(String(notification?.senderUserId || ''))
    );
}

export function getDiscIcon(
    notification: NotificationRow | null | undefined
): LucideIcon {
    const type = String(notification?.type || '');
    if (type === 'event.announcement') {
        return CalendarIcon;
    }
    if (type.startsWith('moderation.')) {
        return ShieldIcon;
    }
    if (type === 'instance.closed') {
        return GlobeIcon;
    }
    if (type === 'economy.alert') {
        return TagIcon;
    }
    if (type.startsWith('group.') || type === 'groupChange') {
        return UsersIcon;
    }
    return BellIcon;
}

export function getResponseIcon(
    response: NotificationResponse | null | undefined,
    notificationType: unknown
): LucideIcon {
    if (response?.type === 'link') {
        return LinkIcon;
    }
    switch (response?.icon) {
        case 'check':
            return CheckIcon;
        case 'cancel':
            return XIcon;
        case 'ban':
            return BanIcon;
        case 'bell-slash':
            return BellOffIcon;
        case 'reply':
            return notificationType === 'boop' ? MessageCircleIcon : ReplyIcon;
        default:
            return TagIcon;
    }
}

export function canMarkNotificationSeen(
    notification: NotificationRow | null | undefined
) {
    return !(
        Number(notification?.version ?? 1) !== 2 &&
        notification?.type === 'friendRequest'
    );
}

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

export function getGroupDisplayName(
    notification: NotificationRow | null | undefined
) {
    return (
        notification?.title ||
        notification?.data?.groupName ||
        notification?.groupName ||
        notification?.details?.groupName ||
        notification?.senderUsername ||
        ''
    );
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

export function computeRemaining(expiresAt: unknown) {
    if (!expiresAt) {
        return null;
    }
    const ts = Date.parse(String(expiresAt));
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

export function buildOrderedActions({
    notification,
    currentUserId,
    canInviteFromCurrentLocation,
    handlers,
    t
}: {
    canInviteFromCurrentLocation: boolean;
    currentUserId?: string;
    handlers: NotificationDrawerHandlers;
    notification: NotificationRow;
    t: TFunction;
}): NotificationDrawerAction[] {
    const remoteActionsVisible =
        notification?.senderUserId !== currentUserId &&
        !isNotificationExpired(notification);
    if (!remoteActionsVisible) {
        return [];
    }
    const type = notification?.type;
    const responses = Array.isArray(notification?.responses)
        ? notification.responses
        : [];
    const actions: NotificationDrawerAction[] = [];
    if (type === 'friendRequest') {
        actions.push({
            key: 'accept',
            label: t('view.notification.actions.accept'),
            Icon: CheckIcon,
            onClick: () => handlers.onAcceptFriendRequest(notification)
        });
    }
    if (type === 'requestInvite' && canInviteFromCurrentLocation) {
        actions.push({
            key: 'invite',
            label: t('view.notification.actions.invite'),
            Icon: SendIcon,
            onClick: () => handlers.onAcceptRequestInvite(notification)
        });
    }
    if (type === 'invite') {
        actions.push({
            key: 'decline-with-message',
            label: t('view.notification.actions.decline_with_message'),
            Icon: MessageCircleIcon,
            onClick: () =>
                handlers.onSendInviteResponseWithMessage(
                    notification,
                    'response'
                )
        });
    }
    if (type === 'requestInvite') {
        actions.push({
            key: 'decline-with-message-request',
            label: t('view.notification.actions.decline_with_message'),
            Icon: MessageCircleIcon,
            onClick: () =>
                handlers.onSendInviteResponseWithMessage(
                    notification,
                    'requestResponse'
                )
        });
    }
    for (const response of responses) {
        actions.push({
            key: `response:${response?.type}:${response?.text || response?.data || ''}`,
            label: getResponseLabel(response),
            Icon: getResponseIcon(response, type),
            onClick: () =>
                handlers.onSendNotificationResponse(notification, response)
        });
    }
    if (canDeclineNotification(notification)) {
        actions.push({
            key: 'decline',
            label: t('view.notification.actions.decline'),
            Icon: XIcon,
            onClick: () => handlers.onHideNotification(notification)
        });
    }
    return actions;
}
