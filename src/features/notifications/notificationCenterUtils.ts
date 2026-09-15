import type { TFunction } from 'i18next';

import type { GroupInstanceRecord } from '@/domain/entities/group';
import { formatDateTime } from '@/lib/dateTime';
import type {
    NotificationResponse,
    NotificationRow
} from '@/repositories/notificationPersistenceRepository';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import { toast } from '@/services/toastService';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { isRecord } from '@/shared/utils/record';
export { resolveCurrentInviteLocation } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { getNotificationTs } from '@/shared/utils/notificationCategory';

type CachedInstanceLike = Record<string, unknown> & {
    closedAt?: string | null;
};

function normalizeWorldTarget(value: string) {
    const text = value.trim();
    const parsed = parseLocation(text);
    if (parsed.isRealInstance && parsed.tag) {
        return parsed.tag;
    }
    return parsed.worldId || text.split(':')[0] || text;
}

export function getNotificationMessage(
    notification: NotificationRow | null | undefined
) {
    return [
        notification?.title,
        notification?.message,
        notification?.details?.inviteMessage,
        notification?.details?.requestMessage,
        notification?.details?.responseMessage,
        notification?.details?.worldName
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ');
}

export function getSenderName(
    notification: NotificationRow | null | undefined
) {
    return (
        notification?.senderDisplayName ||
        notification?.details?.senderDisplayName ||
        notification?.data?.senderDisplayName ||
        notification?.senderUsername ||
        notification?.title ||
        notification?.data?.groupName ||
        notification?.groupName ||
        notification?.details?.groupName ||
        notification?.type ||
        'Notification'
    );
}

function getImageUrl(notification: NotificationRow | null | undefined) {
    return (
        notification?.details?.imageUrl ||
        notification?.imageUrl ||
        notification?.senderUserIcon ||
        ''
    );
}

export function getNotificationImageUrl(
    notification: NotificationRow | null | undefined
) {
    const imageUrl = getImageUrl(notification);
    return imageUrl && !imageUrl.startsWith('default_')
        ? convertFileUrlToImageUrl(imageUrl, 64)
        : '';
}

export function formatNotificationTime(
    notification: NotificationRow | null | undefined
) {
    if (!notification) {
        return '';
    }
    const timestamp = getNotificationTs(notification);
    if (!timestamp) {
        return '';
    }
    return formatDateTime(timestamp, {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function isNotificationExpired(
    notification: NotificationRow | null | undefined
) {
    if (notification?.expired !== undefined) {
        return Boolean(notification.expired);
    }
    if (!notification?.expiresAt) {
        return false;
    }
    const expiresAt = Date.parse(notification.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export function canDeclineNotification(
    notification: NotificationRow | null | undefined
) {
    const type = notification?.type || '';
    const link = notification?.link || '';
    return (
        type !== 'requestInviteResponse' &&
        type !== 'inviteResponse' &&
        type !== 'message' &&
        type !== 'boop' &&
        type !== 'groupChange' &&
        !type.includes('group.') &&
        !type.includes('moderation.') &&
        !type.includes('instance.') &&
        !link.startsWith('economy.')
    );
}

export function shouldShowDeleteLog(
    notification: NotificationRow | null | undefined
) {
    const type = notification?.type || '';
    return type !== 'friendRequest' && type !== 'ignoredFriendRequest';
}

const RESPONSE_TEXT_KEYS: Record<string, string> = {
    'acknowledge and dismiss this notification':
        'view.notification.responses.acknowledge_and_dismiss',
    "unsubscribe from this group's announcements":
        'view.notification.responses.unsubscribe_announcements'
};

export function getResponseLabel(
    response: NotificationResponse | null | undefined,
    t: TFunction
) {
    const text = String(response?.text || '').trim();
    const localizedKey =
        RESPONSE_TEXT_KEYS[text.replaceAll('\u2019', "'").toLowerCase()];
    if (localizedKey) {
        return t(localizedKey);
    }
    return text || response?.type || 'Respond';
}

function getCachedInstanceLocation(instance: GroupInstanceRecord) {
    return String(
        instance.location ||
            instance.$location ||
            instance.instanceLocation ||
            instance.instanceId ||
            ''
    ).trim();
}

export function buildCachedInstanceMap(
    instances: readonly GroupInstanceRecord[]
) {
    const map = new Map<string, CachedInstanceLike>();
    for (const instance of instances) {
        const location = getCachedInstanceLocation(instance);
        if (location) {
            const entry = isRecord(instance.instance)
                ? instance.instance
                : instance;
            map.set(location, entry);
        }
    }
    return map;
}

function openNotificationLink(link: unknown) {
    const value = String(link || '').trim();
    if (!value) {
        return false;
    }
    if (value.startsWith('user:')) {
        const userId = value.slice('user:'.length);
        openUserDialog({ userId });
        return true;
    }
    if (value.startsWith('group:')) {
        const groupId = value.slice('group:'.length);
        openGroupDialog({ groupId });
        return true;
    }
    if (value.startsWith('event:')) {
        const [groupId] = value.slice('event:'.length).split(',');
        if (groupId) {
            openGroupDialog({ groupId });
            return true;
        }
    }
    if (value.startsWith('world:')) {
        const worldId = normalizeWorldTarget(value.slice('world:'.length));
        openWorldDialog({ worldId });
        return true;
    }
    if (value.startsWith('avatar:')) {
        const avatarId = value.slice('avatar:'.length);
        openAvatarDialog({ avatarId });
        return true;
    }
    openExternalLink(value, { directAccess: true });
    return true;
}

export function openSender(
    notification: NotificationRow | null | undefined,
    t: TFunction
) {
    const userId = String(notification?.senderUserId || '').trim();
    const type = String(notification?.type || '');
    if (
        hasGroupIdPrefix(userId) ||
        type.startsWith('group.') ||
        type === 'groupChange'
    ) {
        const groupId = hasGroupIdPrefix(userId)
            ? userId
            : String(
                  notification?.data?.groupId ||
                      notification?.details?.groupId ||
                      ''
              );
        if (groupId) {
            openGroupDialog({ groupId, title: getSenderName(notification) });
            return;
        }
    }
    if (userId) {
        openUserDialog({
            userId,
            title: getSenderName(notification) || undefined
        });
        return;
    }
    if (!openNotificationLink(notification?.link)) {
        toast.add({
            type: 'info',
            title: t(
                'view.notification.description.this_notification_does_not_expose_a_navigable_sender'
            )
        });
    }
}
