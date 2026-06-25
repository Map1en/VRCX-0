import notificationPersistenceRepository from '@/repositories/notificationPersistenceRepository';
import type { QueryParams } from '@/repositories/vrchatRequest';
import vrchatSearchRepository from '@/repositories/vrchatSearchRepository';

interface SendInviteToLocationInput {
    receiverUserId?: unknown;
    endpoint?: string;
    instanceId?: unknown;
    worldId?: unknown;
    worldName?: unknown;
    messageSlot?: unknown;
    imageData?: unknown;
    rsvp?: unknown;
}

interface SendRequestInviteToUserInput {
    receiverUserId?: unknown;
    endpoint?: string;
    platform?: string;
    requestSlot?: unknown;
    imageData?: unknown;
}

interface SendBoopToUserInput {
    userId?: unknown;
    endpoint?: string;
    emojiId?: unknown;
}

function normalizeText(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export async function sendInviteToLocation({
    receiverUserId,
    endpoint = '',
    instanceId,
    worldId,
    worldName,
    messageSlot = null,
    imageData = '',
    rsvp
}: SendInviteToLocationInput = {}) {
    const normalizedReceiverUserId = normalizeText(receiverUserId);
    const normalizedInstanceId = normalizeText(instanceId);
    const normalizedWorldId = normalizeText(worldId);
    if (
        !normalizedReceiverUserId ||
        !normalizedInstanceId ||
        !normalizedWorldId
    ) {
        return null;
    }

    const normalizedWorldName = normalizeText(worldName);
    const worldResponse = normalizedWorldName
        ? null
        : await vrchatSearchRepository.getWorlds({}, normalizedWorldId, {
              endpoint
          });
    const params: QueryParams = {
        instanceId: normalizedInstanceId,
        worldId: normalizedWorldId,
        worldName:
            normalizedWorldName ||
            normalizeText(worldResponse?.json?.name) ||
            normalizedWorldId
    };
    if (typeof rsvp === 'boolean') {
        params.rsvp = rsvp;
    }
    const normalizedMessageSlot = Number.parseInt(
        String(messageSlot ?? ''),
        10
    );
    if (Number.isFinite(normalizedMessageSlot)) {
        params.messageSlot = normalizedMessageSlot;
    }

    const normalizedImageData = normalizeText(imageData);
    if (normalizedImageData) {
        return notificationPersistenceRepository.sendInvitePhoto({
            receiverUserId: normalizedReceiverUserId,
            endpoint,
            params,
            imageData: normalizedImageData
        });
    }

    return notificationPersistenceRepository.sendInvite({
        receiverUserId: normalizedReceiverUserId,
        endpoint,
        params
    });
}

export async function sendRequestInviteToUser({
    receiverUserId,
    endpoint = '',
    platform = 'standalonewindows',
    requestSlot = null,
    imageData = ''
}: SendRequestInviteToUserInput = {}) {
    const normalizedReceiverUserId = normalizeText(receiverUserId);
    if (!normalizedReceiverUserId) {
        return null;
    }

    const params: QueryParams = { platform };
    const normalizedRequestSlot = Number.parseInt(
        String(requestSlot ?? ''),
        10
    );
    if (Number.isFinite(normalizedRequestSlot)) {
        params.requestSlot = normalizedRequestSlot;
    }

    const normalizedImageData = normalizeText(imageData);
    if (normalizedImageData) {
        return notificationPersistenceRepository.sendRequestInvitePhoto({
            receiverUserId: normalizedReceiverUserId,
            endpoint,
            params,
            imageData: normalizedImageData
        });
    }

    return notificationPersistenceRepository.sendRequestInvite({
        receiverUserId: normalizedReceiverUserId,
        endpoint,
        params
    });
}

export async function sendBoopToUser({
    userId,
    endpoint = '',
    emojiId = ''
}: SendBoopToUserInput = {}) {
    const normalizedUserId = normalizeText(userId);
    if (!normalizedUserId) {
        return null;
    }

    return notificationPersistenceRepository.sendBoop({
        userId: normalizedUserId,
        emojiId,
        endpoint
    });
}
