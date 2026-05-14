import {
    configRepository,
    notificationRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';

const AUTO_ACCEPT_OFF = 'Off';
const AUTO_ACCEPT_ALL_FAVORITES = 'All Favorites';
const AUTO_ACCEPT_SELECTED_FAVORITES = 'Selected Favorites';
const DEFAULT_AUTO_INVITE_SENDER_COOLDOWN_MS = 10 * 60 * 1000;

const senderCooldowns = new Map<string, number>();
const pendingSenderInvites = new Set<string>();

function safeJsonParse(value, fallback) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return fallback;
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function normalizeAutoAcceptMode(value) {
    if (
        value === true ||
        value === 'true' ||
        value === AUTO_ACCEPT_ALL_FAVORITES
    ) {
        return AUTO_ACCEPT_ALL_FAVORITES;
    }
    if (value === AUTO_ACCEPT_SELECTED_FAVORITES) {
        return AUTO_ACCEPT_SELECTED_FAVORITES;
    }
    return AUTO_ACCEPT_OFF;
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

function buildCachedInstanceMap(instances) {
    const map = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const location = getCachedInstanceLocation(instance);
        if (location) {
            map.set(location, instance?.instance || instance);
        }
    }
    return map;
}

function resolveCurrentInviteLocation(gameState) {
    const currentLocation = String(gameState?.currentLocation || '').trim();
    return currentLocation && currentLocation !== 'traveling'
        ? currentLocation
        : '';
}

function getVerifiedCurrentLocation(gameState) {
    const currentLocation = String(gameState?.currentLocation || '').trim();
    return currentLocation && currentLocation !== 'traveling'
        ? currentLocation
        : '';
}

function isCurrentInviteScope({ endpoint, currentUserId }) {
    const auth = useRuntimeStore.getState().auth;
    const authCurrentUserId =
        auth.currentUserId || auth.currentUserSnapshot?.id || '';
    return (
        String(auth.currentUserEndpoint || '') === String(endpoint || '') &&
        String(authCurrentUserId) === String(currentUserId || '')
    );
}

function isUserInLocalGroups(userId, localFriendFavorites, groupNames = []) {
    const localGroups = groupNames?.length
        ? groupNames
        : Object.keys(localFriendFavorites || {});
    for (const groupName of localGroups) {
        const ids = localFriendFavorites?.[groupName];
        if (Array.isArray(ids) && ids.includes(userId)) {
            return true;
        }
    }
    return false;
}

function isSenderAllowed({ senderUserId, mode, selectedGroups }) {
    if (!senderUserId || mode === AUTO_ACCEPT_OFF) {
        return false;
    }

    const favoriteState = useFavoriteStore.getState();
    if (mode === AUTO_ACCEPT_ALL_FAVORITES) {
        return (
            favoriteState.favoriteFriendIds.includes(senderUserId) ||
            isUserInLocalGroups(
                senderUserId,
                favoriteState.localFriendFavorites
            )
        );
    }

    for (const groupKey of selectedGroups) {
        if (groupKey.startsWith('local:')) {
            const groupName = groupKey.slice(6);
            if (
                isUserInLocalGroups(
                    senderUserId,
                    favoriteState.localFriendFavorites,
                    [groupName]
                )
            ) {
                return true;
            }
            continue;
        }

        const remoteIds =
            favoriteState.groupedFavoriteFriendIdsByGroupKey[groupKey] || [];
        if (remoteIds.includes(senderUserId)) {
            return true;
        }
    }

    return false;
}

function buildSenderScopeKey({ endpoint, currentUserId, senderUserId }) {
    return [endpoint || '', currentUserId || '', senderUserId || ''].join(':');
}

function isAutoInviteSafeLocation(parsedLocation) {
    if (!parsedLocation?.isRealInstance) {
        return false;
    }
    if (parsedLocation.accessType === 'public') {
        return true;
    }
    return (
        parsedLocation.accessType === 'group' &&
        parsedLocation.groupAccessType === 'public'
    );
}

function isSenderCoolingDown(senderScopeKey, nowMs) {
    const lastSentAt = senderCooldowns.get(senderScopeKey) || 0;
    return nowMs - lastSentAt < DEFAULT_AUTO_INVITE_SENDER_COOLDOWN_MS;
}

function validateCurrentInviteLocation({
    endpoint,
    currentUserId,
    expectedLocation = ''
}) {
    if (!isCurrentInviteScope({ endpoint, currentUserId })) {
        return { valid: false, reason: 'auth-context-changed' };
    }

    const runtimeState = useRuntimeStore.getState();
    if (!runtimeState.gameState?.isGameRunning) {
        return { valid: false, reason: 'game-not-running' };
    }

    const currentInviteLocation = resolveCurrentInviteLocation(
        runtimeState.gameState
    );
    if (!currentInviteLocation) {
        return {
            valid: false,
            reason: 'missing-current-session-or-location'
        };
    }
    if (expectedLocation && currentInviteLocation !== expectedLocation) {
        return { valid: false, reason: 'current-location-changed' };
    }

    const groupInstances =
        runtimeState.groupInstances.endpoint === endpoint
            ? runtimeState.groupInstances.instances
            : [];
    const cachedInstances = buildCachedInstanceMap(groupInstances);
    const canInviteFromCurrentLocation = checkCanInvite(currentInviteLocation, {
        currentUserId,
        lastLocationStr: getVerifiedCurrentLocation(runtimeState.gameState),
        cachedInstances
    });
    if (!canInviteFromCurrentLocation) {
        return { valid: false, reason: 'current-location-not-invitable' };
    }

    const parsedLocation = parseLocation(currentInviteLocation);
    if (!parsedLocation.worldId || !parsedLocation.instanceId) {
        return { valid: false, reason: 'current-location-not-concrete' };
    }
    if (!isAutoInviteSafeLocation(parsedLocation)) {
        return {
            valid: false,
            reason: 'current-location-not-auto-invite-safe'
        };
    }

    return {
        valid: true,
        currentInviteLocation,
        parsedLocation
    };
}

async function expireNotificationLocally({ userId, notification }) {
    if (!userId || !notification?.id) {
        return;
    }
    await notificationRepository.expireNotification({
        userId,
        id: notification.id
    });
    const store = useVrcNotificationStore.getState();
    store.expireNotifications(notification.id);
    store.markNotificationsSeen(notification.id);
}

async function cleanupHandledInviteRequestNotification({
    currentUserId,
    endpoint,
    notification,
    senderUserId
}) {
    let cleanupFailed = false;

    try {
        await notificationRepository.hideRemoteNotification({
            id: notification.id,
            version: notification.version,
            type: notification.type,
            senderUserId,
            endpoint
        });
    } catch (error) {
        cleanupFailed = true;
        console.warn(
            'Failed to hide handled invite request notification:',
            error
        );
    }

    try {
        await expireNotificationLocally({ userId: currentUserId, notification });
    } catch (error) {
        cleanupFailed = true;
        console.warn(
            'Failed to expire handled invite request notification locally:',
            error
        );
    }

    return cleanupFailed ? 'invite-sent-cleanup-failed' : 'invite-sent';
}

async function sendInviteForRequest({
    notification,
    endpoint,
    currentUserId,
    currentInviteLocation,
    parsedLocation
}) {
    const worldResponse = await vrchatSearchRepository.getWorlds(
        {},
        parsedLocation.worldId,
        { endpoint }
    );
    const currentLocationValidation = validateCurrentInviteLocation({
        endpoint,
        currentUserId,
        expectedLocation: currentInviteLocation
    });
    if (!currentLocationValidation.valid) {
        return { sent: false, reason: currentLocationValidation.reason };
    }
    const worldJson = worldResponse.json as Record<string, any> | undefined;
    await notificationRepository.sendInvite({
        receiverUserId: notification.senderUserId,
        endpoint,
        params: {
            instanceId: currentInviteLocation,
            worldId: parsedLocation.worldId,
            worldName: worldJson?.name || parsedLocation.worldId,
            rsvp: true
        }
    });
    return { sent: true };
}

export async function handleInviteAutomationNotification(notification) {
    if (notification?.type !== 'requestInvite') {
        return { handled: false, reason: 'not-request-invite' };
    }

    const senderUserId = String(notification.senderUserId || '').trim();
    if (!notification.id || !senderUserId) {
        return { handled: false, reason: 'missing-notification-or-sender' };
    }

    const mode = normalizeAutoAcceptMode(
        await configRepository.getString(
            'autoAcceptInviteRequests',
            AUTO_ACCEPT_OFF
        )
    );
    if (mode === AUTO_ACCEPT_OFF) {
        return { handled: false, reason: 'disabled' };
    }

    const selectedGroups = safeJsonParse(
        await configRepository.getString('autoAcceptInviteGroups', '[]'),
        []
    );
    if (!isSenderAllowed({ senderUserId, mode, selectedGroups })) {
        return { handled: false, reason: 'sender-not-allowlisted' };
    }

    const runtimeState = useRuntimeStore.getState();
    const auth = runtimeState.auth;
    if (!runtimeState.gameState?.isGameRunning) {
        return { handled: false, reason: 'game-not-running' };
    }

    const currentUserId =
        auth.currentUserId || auth.currentUserSnapshot?.id || '';
    const endpoint = auth.currentUserEndpoint || '';
    const currentInviteLocation = resolveCurrentInviteLocation(
        runtimeState.gameState
    );
    if (!currentUserId || !currentInviteLocation) {
        return { handled: false, reason: 'missing-current-session-or-location' };
    }

    const nowMs = Date.now();
    const senderScopeKey = buildSenderScopeKey({
        endpoint,
        currentUserId,
        senderUserId
    });
    if (isSenderCoolingDown(senderScopeKey, nowMs)) {
        return { handled: false, reason: 'sender-cooldown' };
    }
    if (pendingSenderInvites.has(senderScopeKey)) {
        return { handled: false, reason: 'sender-invite-pending' };
    }

    const currentLocationValidation = validateCurrentInviteLocation({
        endpoint,
        currentUserId,
        expectedLocation: currentInviteLocation
    });
    if (!currentLocationValidation.valid) {
        return {
            handled: false,
            reason: currentLocationValidation.reason
        };
    }

    pendingSenderInvites.add(senderScopeKey);
    try {
        if (!isCurrentInviteScope({ endpoint, currentUserId })) {
            return { handled: false, reason: 'auth-context-changed' };
        }
        const sendResult = await sendInviteForRequest({
            notification,
            endpoint,
            currentUserId,
            currentInviteLocation,
            parsedLocation: currentLocationValidation.parsedLocation
        });
        if (!sendResult.sent) {
            return { handled: false, reason: sendResult.reason };
        }
        senderCooldowns.set(senderScopeKey, nowMs);
        if (!isCurrentInviteScope({ endpoint, currentUserId })) {
            return {
                handled: true,
                reason: 'invite-sent-auth-context-changed',
                senderUserId,
                notificationId: notification.id
            };
        }

        const cleanupReason = await cleanupHandledInviteRequestNotification({
            currentUserId,
            endpoint,
            notification,
            senderUserId,
        });
        return {
            handled: true,
            reason: cleanupReason,
            senderUserId,
            notificationId: notification.id
        };
    } finally {
        pendingSenderInvites.delete(senderScopeKey);
    }
}

export function resetInviteAutomationService() {
    senderCooldowns.clear();
    pendingSenderInvites.clear();
}
