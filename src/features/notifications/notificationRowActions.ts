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
    UsersRoundIcon,
    XIcon,
    type LucideIcon
} from 'lucide-react';

import type {
    NotificationResponse,
    NotificationRow
} from '@/repositories/notificationPersistenceRepository';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { isInviteNotificationType } from '@/shared/utils/notificationLifecycle';
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

export type NotificationActionScope = 'vrchat' | 'local';

export type NotificationRowAction = {
    Icon: LucideIcon;
    key: string;
    label: string;
    scope: NotificationActionScope;
    onClick: () => void;
};

export function getNotificationActionScopeLabel(
    scope: NotificationActionScope,
    t: TFunction
): string {
    return scope === 'local'
        ? t('view.notification.action_scope.local')
        : t('view.notification.action_scope.vrchat');
}

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
        return UsersRoundIcon;
    }
    return BellIcon;
}

function getResponseIcon(
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
            return UsersRoundIcon;
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
            scope: 'vrchat',
            onClick: () => handlers.onAcceptFriendRequest(notification)
        });
    }
    if (type === 'requestInvite' && canInviteFromCurrentLocation) {
        actions.push({
            key: 'invite',
            label: t('view.notification.actions.invite'),
            Icon: SendIcon,
            scope: 'vrchat',
            onClick: () => handlers.onAcceptRequestInvite(notification)
        });
    }
    if (type === 'invite') {
        actions.push({
            key: 'decline-with-message',
            label: t('view.notification.actions.decline_with_message'),
            Icon: MessageCircleIcon,
            scope: 'vrchat',
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
            scope: 'vrchat',
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
            scope: 'vrchat',
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
            label: getResponseLabel(response, t),
            Icon: getResponseIcon(response, type),
            scope: 'vrchat',
            onClick: () =>
                handlers.onSendNotificationResponse(notification, response)
        });
    }
    if (canDeclineNotification(notification)) {
        const isFriendRequest = type === 'friendRequest';
        actions.push({
            key: isFriendRequest ? 'ignore' : 'decline',
            label: isFriendRequest
                ? t('view.notification.actions.ignore')
                : t('view.notification.actions.decline'),
            Icon: isFriendRequest ? BellOffIcon : XIcon,
            scope: 'vrchat',
            onClick: () => handlers.onHideNotification(notification)
        });
    }
    if (
        isInviteNotificationType(type) ||
        ((type === 'friendRequest' || type === 'boop') &&
            isUnseenNotification(notification))
    ) {
        actions.push({
            key: 'mark-seen',
            label: t('view.notification.action.mark_seen'),
            Icon: CheckCheckIcon,
            scope: 'vrchat',
            onClick: () => handlers.onMarkSeen(notification)
        });
    }
    return actions;
}
