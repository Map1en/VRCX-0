import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { parseLocation } from '@/shared/utils/locationParser.js';

export function getNotificationCreatedAt(notification) {
    return notification?.createdAt || notification?.created_at || '';
}

export function getNotificationMessage(notification) {
    const generatedInviteMessage = notification.details?.worldName
        ? `This is a generated invite to ${notification.details.worldName}`
        : '';
    const message = notification.message === generatedInviteMessage ? '' : notification.message;
    return [
        notification.title,
        message,
        notification.details?.inviteMessage,
        notification.details?.requestMessage,
        notification.details?.responseMessage
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(notification.title && notification.message ? ', ' : ' ');
}

export function getNotificationGroupLabel(notification, includeLinkText = false) {
    return (
        notification.data?.groupName ||
        notification.details?.groupName ||
        notification.groupName ||
        (includeLinkText ? notification.linkText : '') ||
        ''
    );
}

export function getNotificationGroupColumnLabel(notification) {
    const isGroupLink = notification?.link?.startsWith('group:') || notification?.link?.startsWith('event:');
    const explicitGroupLabel = getNotificationGroupLabel(notification, isGroupLink);
    if (notification?.senderUserId?.startsWith('grp_') || notification?.type === 'groupChange') {
        return notification?.senderUsername || explicitGroupLabel || '';
    }
    return explicitGroupLabel;
}

export function matchesNotificationSearch(notification, search) {
    const query = String(search || '').trim().toLowerCase();
    if (!query) {
        return true;
    }

    return [
        notification.type,
        notification.senderUsername,
        notification.senderUserId,
        notification.title,
        notification.message,
        notification.linkText,
        notification.link,
        notification.details?.worldName,
        notification.details?.worldId,
        notification.details?.inviteMessage,
        notification.details?.requestMessage,
        notification.details?.responseMessage,
        notification.data?.groupName
    ].some((value) => String(value || '').toLowerCase().includes(query));
}

export function filterNotificationRows(rows, filters, search) {
    const activeFilters = Array.isArray(filters) ? filters : [];
    return (Array.isArray(rows) ? rows : []).filter((notification) => {
        if (activeFilters.length && !activeFilters.includes(notification.type)) {
            return false;
        }
        return matchesNotificationSearch(notification, search);
    });
}

export function normalizeWorldTarget(value) {
    const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    return parseLocation(text).worldId || text.split(':')[0] || text;
}

export function resolveCurrentInviteLocation(gameState, currentUserSnapshot) {
    const currentLocation = String(gameState?.currentLocation || '').trim();
    if (currentLocation === 'traveling') {
        return String(gameState?.currentDestination || '').trim();
    }
    return (
        currentLocation ||
        String(gameState?.currentDestination || '').trim() ||
        String(currentUserSnapshot?.$locationTag || currentUserSnapshot?.location || '').trim()
    );
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

export function getResponseLabel(response) {
    return response?.text || response?.type || 'Respond';
}

export function getFileImageUrl(file) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    const version = versions.at(-1);
    const url = version?.file?.url || file?.url || file?.imageUrl || '';
    return url ? convertFileUrlToImageUrl(url, 128) : '';
}

export function getCachedInstanceLocation(instance) {
    return String(instance?.location || instance?.instance?.location || instance?.instanceId || '').trim();
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

export function normalizeInviteMessageRows(value, messageType) {
    const rows = Array.isArray(value)
        ? value
        : Array.isArray(value?.messages)
            ? value.messages
            : value && typeof value === 'object'
                ? Object.values(value).filter((row) => row && typeof row === 'object')
                : [];

    return rows
        .map((row, index) => ({
            ...row,
            slot: Number.parseInt(row?.slot ?? index, 10),
            message: String(row?.message || row?.text || ''),
            messageType
        }))
        .filter((row) => Number.isFinite(row.slot))
        .sort((left, right) => left.slot - right.slot);
}

export function getInviteCooldownLabel(updatedAt, nowMs) {
    if (!updatedAt) {
        return '';
    }
    const updatedTime = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedTime)) {
        return String(updatedAt);
    }
    const remainingMs = updatedTime + 60 * 60 * 1000 - Number(nowMs);
    if (remainingMs <= 0) {
        return '';
    }
    const minutes = Math.ceil(remainingMs / 60000);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
