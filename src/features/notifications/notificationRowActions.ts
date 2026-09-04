import type { TFunction } from 'i18next';
import {
    BanIcon,
    BellIcon,
    BellOffIcon,
    CalendarIcon,
    CheckCheckIcon,
    CheckIcon,
    ExternalLinkIcon,
    GlobeIcon,
    LinkIcon,
    MessageCircleIcon,
    PersonStandingIcon,
    ReplyIcon,
    SendIcon,
    ShieldIcon,
    TagIcon,
    UserIcon,
    UsersIcon,
    XIcon,
    type LucideIcon
} from 'lucide-react';

import type {
    NotificationResponse,
    NotificationRow
} from '@/repositories/notificationPersistenceRepository';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { isUnseenNotification } from '@/shared/utils/notificationSeen';

import {
    canDeclineNotification,
    getResponseLabel,
    isNotificationExpired
} from './notificationCenterUtils';
import { getNotificationLinkScheme } from './notificationViewModel';

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

export type NotificationRowAction = {
    Icon: LucideIcon;
    key: string;
    label: string;
    onClick: () => void;
};

export type NotificationRowActionHandlers = {
    onAcceptFriendRequest(notification: NotificationRow): void | Promise<void>;
    onAcceptRequestInvite(notification: NotificationRow): void | Promise<void>;
    onHideNotification(notification: NotificationRow): void | Promise<void>;
    onMarkSeen(notification: NotificationRow): void | Promise<void>;
    onSendInviteResponseWithMessage(
        notification: NotificationRow,
        messageType: string
    ): void;
    onSendNotificationResponse(
        notification: NotificationRow,
        response: NotificationResponse
    ): void | Promise<void>;
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
    if (type === 'event.announcement' || type === 'group.event.created') {
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
    notificationType: string | undefined
): LucideIcon {
    if (response?.type === 'link') {
        return LinkIcon;
    }
    switch (response?.icon) {
        case 'check':
            return response?.type === 'delete' ? CheckCheckIcon : CheckIcon;
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

export function getNotificationLinkIcon(
    link: string | null | undefined
): LucideIcon {
    switch (getNotificationLinkScheme(link)) {
        case 'user':
            return UserIcon;
        case 'group':
            return UsersIcon;
        case 'event':
            return CalendarIcon;
        case 'world':
            return GlobeIcon;
        case 'avatar':
            return PersonStandingIcon;
        default:
            return ExternalLinkIcon;
    }
}

export const PRIMARY_ACTION_KEYS = new Set<string>(['accept', 'invite']);

const MANUAL_BOOP_REPLY_RESPONSE = {
    icon: 'reply',
    type: 'reply'
} satisfies NotificationResponse;

export function buildOrderedActions({
    notification,
    currentUserId,
    canInviteFromCurrentLocation,
    handlers,
    t
}: {
    canInviteFromCurrentLocation: boolean;
    currentUserId?: string;
    handlers: NotificationRowActionHandlers;
    notification: NotificationRow;
    t: TFunction;
}): NotificationRowAction[] {
    const type = notification?.type;
    const isRemoteSender = notification?.senderUserId !== currentUserId;
    const canReplyToBoop =
        isRemoteSender && type === 'boop' && Boolean(notification.senderUserId);
    if (
        !isRemoteSender ||
        (isNotificationExpired(notification) && !canReplyToBoop)
    ) {
        return [];
    }
    const responses = Array.isArray(notification?.responses)
        ? notification.responses
        : [];
    const actions: NotificationRowAction[] = [];
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
    if (canReplyToBoop) {
        actions.push({
            key: 'reply-boop',
            label: t('view.notification.action.send_boop'),
            Icon: ReplyIcon,
            onClick: () =>
                handlers.onSendNotificationResponse(
                    notification,
                    MANUAL_BOOP_REPLY_RESPONSE
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
    if (type === 'friendRequest' && isUnseenNotification(notification)) {
        actions.push({
            key: 'mark-seen',
            label: t('view.notification.action.mark_seen'),
            Icon: CheckCheckIcon,
            onClick: () => handlers.onMarkSeen(notification)
        });
    }
    return actions;
}
