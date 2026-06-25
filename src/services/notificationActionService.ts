import notificationPersistenceRepository from '@/repositories/notificationPersistenceRepository';
import { useShellStore } from '@/state/shellStore';

import {
    recordFriendLogFriendByUserId,
    registerFriendLogExplicitAddIntent
} from './friendBootstrapService';
import { sendBoopToUser, sendInviteToLocation } from './inviteDeliveryService';

type NotificationRecord = Record<string, unknown> & {
    id?: unknown;
    version?: unknown;
    type?: unknown;
    senderUserId?: unknown;
    senderUsername?: unknown;
    expired?: unknown;
    link?: unknown;
};

interface NotificationActionInput {
    currentUserId?: unknown;
    endpoint?: string;
    notification?: NotificationRecord | null;
}

interface FriendRequestNotificationInput extends NotificationActionInput {
    targetUser?: NotificationRecord | null;
    stateBucket?: unknown;
}

interface AcceptRequestInviteInput extends NotificationActionInput {
    instanceId?: unknown;
    worldId?: unknown;
}

interface InviteResponseInput extends NotificationActionInput {
    responseSlot?: unknown;
    imageData?: unknown;
    withUploadTimeout?: (promise: Promise<unknown>) => Promise<unknown>;
}

interface NotificationResponseInput extends NotificationActionInput {
    response?: NotificationRecord | null;
}

interface BoopReplyInput extends NotificationActionInput {
    emojiId?: unknown;
}

function normalizeText(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isNotFoundError(error: unknown): boolean {
    return Boolean(
        error &&
        typeof error === 'object' &&
        'status' in error &&
        (error as { status?: unknown }).status === 404
    );
}

function requireNotification(
    notification: NotificationRecord | null | undefined
) {
    if (!notification) {
        throw new Error('Notification action requires a notification.');
    }
    return notification;
}

export async function findIncomingFriendRequestNotification({
    currentUserId,
    targetUserId
}: {
    currentUserId?: unknown;
    targetUserId?: unknown;
}) {
    const normalizedCurrentUserId = normalizeText(currentUserId);
    const normalizedTargetUserId = normalizeText(targetUserId);
    if (!normalizedCurrentUserId || !normalizedTargetUserId) {
        return null;
    }

    const rows = await notificationPersistenceRepository.queryNotifications({
        userId: normalizedCurrentUserId,
        filters: ['friendRequest']
    });
    return (
        rows.find(
            (row) =>
                row?.type === 'friendRequest' &&
                !row.expired &&
                normalizeText(row.senderUserId) === normalizedTargetUserId
        ) || null
    );
}

export async function expireNotificationLocally({
    currentUserId,
    notification
}: NotificationActionInput) {
    const target = requireNotification(notification);
    await notificationPersistenceRepository.expireNotification({
        userId: currentUserId,
        id: target.id
    });
}

async function hideRemoteNotification({
    endpoint = '',
    notification
}: NotificationActionInput) {
    const target = requireNotification(notification);
    await notificationPersistenceRepository.hideRemoteNotification({
        id: target.id,
        version: target.version,
        type: normalizeText(target.type),
        senderUserId: target.senderUserId,
        endpoint
    });
}

export async function hideRemoteAndExpireNotification({
    currentUserId,
    endpoint = '',
    notification
}: NotificationActionInput) {
    await hideRemoteNotification({ endpoint, notification });
    await expireNotificationLocally({ currentUserId, notification });
}

export async function acceptFriendRequestNotification({
    currentUserId,
    endpoint = '',
    notification,
    targetUser = null,
    stateBucket = 'offline'
}: FriendRequestNotificationInput) {
    const target = requireNotification(notification);
    const targetUserId = normalizeText(target.senderUserId);
    let clearFriendLogAddIntent = () => {};

    try {
        clearFriendLogAddIntent = registerFriendLogExplicitAddIntent({
            currentUserId,
            targetUserId
        });
        await notificationPersistenceRepository.acceptFriendRequest({
            id: target.id,
            endpoint
        });
        try {
            const friendLogResult = await recordFriendLogFriendByUserId({
                currentUserId,
                targetUserId,
                targetUser: targetUser || {
                    id: target.senderUserId,
                    displayName: target.senderUsername
                },
                stateBucket
            });
            if (friendLogResult?.historyCount > 0) {
                useShellStore.getState().notifyMenu('friend-log');
            }
        } catch (error) {
            clearFriendLogAddIntent();
            console.warn('Friend log add recording failed:', error);
        }
        await expireNotificationLocally({
            currentUserId,
            notification: target
        });
        return { status: 'accepted' as const };
    } catch (error) {
        clearFriendLogAddIntent();
        if (isNotFoundError(error)) {
            await expireNotificationLocally({
                currentUserId,
                notification: target
            });
            return { status: 'not-found' as const };
        }
        throw error;
    }
}

export async function acceptRequestInviteNotification({
    currentUserId,
    endpoint = '',
    notification,
    instanceId,
    worldId
}: AcceptRequestInviteInput) {
    const target = requireNotification(notification);
    await sendInviteToLocation({
        receiverUserId: target.senderUserId,
        endpoint,
        instanceId,
        worldId,
        rsvp: true
    });
    await hideRemoteAndExpireNotification({
        currentUserId,
        endpoint,
        notification: target
    });
}

export async function sendInviteResponseNotification({
    currentUserId,
    endpoint = '',
    notification,
    responseSlot,
    imageData,
    withUploadTimeout
}: InviteResponseInput) {
    const target = requireNotification(notification);
    const normalizedResponseSlot = Number.parseInt(
        String(responseSlot ?? ''),
        10
    );
    if (!Number.isFinite(normalizedResponseSlot)) {
        throw new Error('Response slot must be a number.');
    }

    if (imageData) {
        const upload =
            notificationPersistenceRepository.sendInviteResponsePhoto({
                id: target.id,
                responseSlot: normalizedResponseSlot,
                imageData,
                endpoint
            });
        if (withUploadTimeout) {
            await withUploadTimeout(upload);
        } else {
            await upload;
        }
    } else {
        await notificationPersistenceRepository.sendInviteResponse({
            id: target.id,
            responseSlot: normalizedResponseSlot,
            endpoint
        });
    }

    await hideRemoteAndExpireNotification({
        currentUserId,
        endpoint,
        notification: target
    });
    return { sentPhoto: Boolean(imageData) };
}

export async function dismissBoopNotifications({
    currentUserId,
    endpoint = '',
    senderUserId
}: {
    currentUserId?: unknown;
    endpoint?: string;
    senderUserId?: unknown;
}) {
    const normalizedSenderUserId = normalizeText(senderUserId);
    if (!currentUserId || !normalizedSenderUserId) {
        return;
    }
    const items = await notificationPersistenceRepository.queryNotifications({
        userId: currentUserId,
        filters: ['boop']
    });
    const matchingRows = items.filter(
        (item) =>
            item?.type === 'boop' &&
            !item.expired &&
            item.link === `user:${normalizedSenderUserId}`
    );
    await Promise.allSettled(
        matchingRows.map(async (item) => {
            try {
                await notificationPersistenceRepository.hideRemoteNotification({
                    id: item.id,
                    version: item.version,
                    type: normalizeText(item.type),
                    senderUserId: item.senderUserId,
                    endpoint
                });
            } finally {
                await notificationPersistenceRepository.expireNotification({
                    userId: currentUserId,
                    id: item.id
                });
            }
        })
    );
}

export async function sendBoopReplyNotification({
    currentUserId,
    endpoint = '',
    notification,
    emojiId = ''
}: BoopReplyInput) {
    const target = requireNotification(notification);
    const senderUserId = normalizeText(target.senderUserId);
    if (!senderUserId) {
        throw new Error('Cannot send boop: no sender user id is available.');
    }
    await dismissBoopNotifications({
        currentUserId,
        endpoint,
        senderUserId
    });
    await sendBoopToUser({
        userId: senderUserId,
        emojiId,
        endpoint
    });
    await hideRemoteNotification({ endpoint, notification: target }).catch(
        () => {}
    );
    await expireNotificationLocally({ currentUserId, notification: target });
}

export async function sendNotificationButtonResponse({
    currentUserId,
    endpoint = '',
    notification,
    response
}: NotificationResponseInput) {
    const target = requireNotification(notification);
    try {
        await notificationPersistenceRepository.sendNotificationResponse({
            id: target.id,
            responseType: response?.type,
            responseData: response?.data || '',
            endpoint
        });
        await expireNotificationLocally({
            currentUserId,
            notification: target
        });
    } catch (error) {
        if (Number(target.version) >= 2) {
            await expireNotificationLocally({
                currentUserId,
                notification: target
            });
        }
        throw error;
    }
}
