import { toast } from 'sonner';

import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/lib/entityMedia.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { getNotificationTs } from '@/shared/utils/notificationCategory.js';

export const categoryOrder = ['friend', 'group', 'other'];

function normalizeWorldTarget(value) {
    const text =
        typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    const parsed = parseLocation(text);
    if (parsed.isRealInstance && parsed.tag) {
        return parsed.tag;
    }
    return parsed.worldId || text.split(':')[0] || text;
}

export function getNotificationMessage(notification) {
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

export function getSenderName(notification) {
    return (
        notification?.title ||
        notification?.senderUsername ||
        notification?.data?.groupName ||
        notification?.groupName ||
        notification?.details?.groupName ||
        notification?.type ||
        'Notification'
    );
}

export function getImageUrl(notification) {
    return (
        notification?.details?.imageUrl ||
        notification?.imageUrl ||
        notification?.senderUserIcon ||
        ''
    );
}

export function getNotificationImageUrl(notification) {
    const imageUrl = getImageUrl(notification);
    return imageUrl && !imageUrl.startsWith('default_')
        ? convertFileUrlToImageUrl(imageUrl, 64)
        : '';
}

export function formatNotificationTime(notification) {
    const timestamp = getNotificationTs(notification);
    if (!timestamp) {
        return '';
    }
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(timestamp));
}

export function isNotificationExpired(notification) {
    if (notification?.expired !== undefined) {
        return Boolean(notification.expired);
    }
    if (!notification?.expiresAt) {
        return false;
    }
    const expiresAt = Date.parse(notification.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export function canDeclineNotification(notification) {
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

export function shouldShowDeleteLog(notification) {
    const type = notification?.type || '';
    return type !== 'friendRequest' && type !== 'ignoredFriendRequest';
}

export function getResponseLabel(response) {
    return response?.text || response?.type || 'Respond';
}

export function resolveCurrentInviteLocation(gameState, currentUserSnapshot) {
    const currentLocation = String(gameState?.currentLocation || '').trim();
    if (currentLocation === 'traveling') {
        return String(gameState?.currentDestination || '').trim();
    }
    return (
        currentLocation ||
        String(gameState?.currentDestination || '').trim() ||
        String(
            currentUserSnapshot?.$locationTag ||
                currentUserSnapshot?.location ||
                ''
        ).trim()
    );
}

function getCachedInstanceLocation(instance) {
    return String(
        instance?.location ||
            instance?.$location ||
            instance?.instanceLocation ||
            instance?.instanceId ||
            ''
    ).trim();
}

export function buildCachedInstanceMap(instances) {
    const map = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const location = getCachedInstanceLocation(instance);
        if (location) {
            map.set(location, instance?.instance || instance);
        }
    }
    return map;
}

export function openNotificationLink(link) {
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
    void openExternalLink(value);
    return true;
}

export function openSender(notification, t) {
    const userId = String(notification?.senderUserId || '').trim();
    if (
        userId.startsWith('grp_') ||
        notification?.type?.startsWith('group.') ||
        notification?.type === 'groupChange'
    ) {
        const groupId = userId.startsWith('grp_')
            ? userId
            : notification?.data?.groupId ||
              notification?.details?.groupId ||
              '';
        if (groupId) {
            openGroupDialog({ groupId, title: getSenderName(notification) });
            return;
        }
    }
    if (userId) {
        openUserDialog({
            userId,
            title: notification?.senderUsername || undefined
        });
        return;
    }
    if (!openNotificationLink(notification?.link)) {
        toast.info(
            t(
                'view.notification.generated.this_notification_does_not_expose_a_navigable_sender'
            )
        );
    }
}
