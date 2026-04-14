import { parseLocation } from '@/shared/utils/locationParser.js';
import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import { configRepository } from '@/repositories/index.js';
import { database } from '@/services/database/index.js';
import { useFeedLiveStore } from '@/state/feedLiveStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { handleRealtimeNotificationEvent } from './vrcNotificationRuntimeService.js';
import { pushSharedFeedNotification } from './sharedFeedFilterService.js';

const PENDING_OFFLINE_DELAY_MS = 170000;
const UNKNOWN_FEED_USER_DISPLAY_NAME = 'Unknown';
const pendingOfflineTimers = new Map();
let logEmptyAvatars = false;
let logEmptyAvatarsLoaded = false;
let logEmptyAvatarsLoadPromise = null;
let unsubscribeLogEmptyAvatars = null;

function normalizeUserId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeStateBucket(value) {
    const normalized = normalizeUserId(value).toLowerCase();
    if (normalized === 'online' || normalized === 'active' || normalized === 'offline') {
        return normalized;
    }
    return '';
}

function resolveStateBucketFromEvent(content, patch, previous, fallback = 'offline') {
    return (
        normalizeStateBucket(content?.stateBucket) ||
        normalizeStateBucket(content?.state) ||
        normalizeStateBucket(content?.user?.stateBucket) ||
        normalizeStateBucket(content?.user?.state) ||
        normalizeStateBucket(patch?.stateBucket) ||
        normalizeStateBucket(patch?.state) ||
        normalizeStateBucket(previous?.stateBucket) ||
        normalizeStateBucket(previous?.state) ||
        fallback
    );
}

function hasEventStateBucket(content) {
    return Boolean(
        normalizeStateBucket(content?.stateBucket) ||
        normalizeStateBucket(content?.state) ||
        normalizeStateBucket(content?.user?.stateBucket) ||
        normalizeStateBucket(content?.user?.state)
    );
}

function isUserIdLike(value) {
    const normalized = normalizeUserId(value);
    return normalized.startsWith('usr_');
}

function getDisplayName(user, userId = '') {
    const normalizedUserId = normalizeUserId(userId || user?.id);
    const candidates = [user?.displayName, user?.username];

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeUserId(candidate);
        if (
            normalizedCandidate &&
            normalizedCandidate !== normalizedUserId &&
            normalizedCandidate !== UNKNOWN_FEED_USER_DISPLAY_NAME &&
            !isUserIdLike(normalizedCandidate)
        ) {
            return normalizedCandidate;
        }
    }

    return '';
}

function resolveFeedDisplayName(userId, patch = {}, previous = {}) {
    const normalizedUserId = normalizeUserId(userId);
    const rosterFriend = normalizedUserId
        ? useFriendRosterStore.getState().friendsById[normalizedUserId]
        : null;
    return (
        getDisplayName(patch, normalizedUserId) ||
        getDisplayName(previous, normalizedUserId) ||
        getDisplayName(rosterFriend, normalizedUserId) ||
        UNKNOWN_FEED_USER_DISPLAY_NAME
    );
}

function sanitizeTransportUser(user, { preserveState = false } = {}) {
    if (!user || typeof user !== 'object') {
        return null;
    }

    const sanitized = { ...user };
    if (!preserveState) {
        delete sanitized.state;
    }
    return sanitized;
}

function removeFromArray(list, userId) {
    if (!Array.isArray(list) || !userId) {
        return [];
    }

    return list.filter((value) => normalizeUserId(value) !== userId);
}

function ensureArrayMembership(list, userId) {
    if (!userId) {
        return Array.isArray(list) ? list : [];
    }

    const values = Array.isArray(list) ? removeFromArray(list, userId) : [];
    values.push(userId);
    return values;
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return '';
}

function buildLocationPatch(location, travelingToLocation, worldId, fallback = {}) {
    const normalizedLocation = firstString(location, fallback.location, fallback.$location?.tag);
    const normalizedTraveling = firstString(
        travelingToLocation,
        fallback.travelingToLocation,
        fallback.$travelingToLocation?.tag
    );
    const parsedLocation = parseLocation(normalizedLocation);
    const parsedTraveling = parseLocation(normalizedTraveling);

    return {
        location: normalizedLocation,
        worldId:
            firstString(worldId, parsedLocation.worldId, fallback.worldId),
        instanceId: parsedLocation.instanceId || '',
        travelingToLocation: normalizedTraveling,
        travelingToWorld: parsedTraveling.worldId || '',
        travelingToInstance: parsedTraveling.instanceId || '',
        $location: parsedLocation,
        $travelingToLocation: parsedTraveling
    };
}

function onlinePresenceFallback(previous) {
    const location = firstString(previous?.location, previous?.$location?.tag).toLowerCase();
    if (!location || location === 'offline' || location === 'offline:offline') {
        return {};
    }
    return previous;
}

function isRealLocation(location) {
    const value = typeof location === 'string' ? location.trim() : '';
    return Boolean(value && value !== 'offline' && value !== 'traveling' && value !== 'private');
}

function isOnlineState(row) {
    return normalizeStateBucket(row?.stateBucket || row?.state) === 'online';
}

function initLogEmptyAvatarsPreference() {
    if (unsubscribeLogEmptyAvatars) {
        return;
    }
    unsubscribeLogEmptyAvatars = onPreferenceChanged('logEmptyAvatars', (value) => {
        logEmptyAvatars = Boolean(value);
        logEmptyAvatarsLoaded = true;
        logEmptyAvatarsLoadPromise = null;
    });
    logEmptyAvatarsLoadPromise = configRepository
        .getBool('logEmptyAvatars', false)
        .then((value) => {
            logEmptyAvatars = Boolean(value);
            logEmptyAvatarsLoaded = true;
            logEmptyAvatarsLoadPromise = null;
        })
        .catch(() => {
            logEmptyAvatarsLoaded = true;
            logEmptyAvatarsLoadPromise = null;
        });
}

function shouldRecordAvatarChange(currentAvatarImageUrl, previousAvatarImageUrl) {
    initLogEmptyAvatarsPreference();
    if (!logEmptyAvatarsLoaded && !logEmptyAvatarsLoadPromise) {
        logEmptyAvatarsLoadPromise = configRepository
            .getBool('logEmptyAvatars', false)
            .then((value) => {
                logEmptyAvatars = Boolean(value);
                logEmptyAvatarsLoaded = true;
                logEmptyAvatarsLoadPromise = null;
            })
            .catch(() => {
                logEmptyAvatarsLoaded = true;
                logEmptyAvatarsLoadPromise = null;
            });
    }
    return Boolean(
        currentAvatarImageUrl !== previousAvatarImageUrl &&
            (logEmptyAvatars || previousAvatarImageUrl)
    );
}

function resolveLocationName(location, patch = {}, previous = {}) {
    const parsed = parseLocation(location || '');
    return {
        worldName: patch.worldName || patch.world?.name || previous.worldName || parsed.worldId || location || '',
        groupName: patch.groupName || previous.groupName || parsed.groupId || ''
    };
}

function resolveDuration(previous) {
    const timestamp = Number(previous?.locationUpdatedAt || previous?.$location_at || 0);
    return timestamp > 0 ? Date.now() - timestamp : '';
}

function buildFeedBase({ type, userId, patch = {}, previous = {} }) {
    return {
        created_at: new Date().toJSON(),
        type,
        userId,
        displayName: resolveFeedDisplayName(userId, patch, previous)
    };
}

function currentSessionUserId() {
    return normalizeUserId(useRuntimeStore.getState().auth.currentUserId);
}

function cancelPendingOffline(userId) {
    const normalizedUserId = normalizeUserId(userId);
    const pending = pendingOfflineTimers.get(normalizedUserId);
    if (!pending) {
        return false;
    }
    clearTimeout(pending.timeoutId);
    pendingOfflineTimers.delete(normalizedUserId);
    return true;
}

function scheduleOfflineFeed({ userId, patch = {}, previous = {} }) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId || !isOnlineState(previous)) {
        return false;
    }
    cancelPendingOffline(normalizedUserId);
    const ownerUserId = currentSessionUserId();
    const timeoutId = setTimeout(() => {
        pendingOfflineTimers.delete(normalizedUserId);
        if (!ownerUserId || currentSessionUserId() !== ownerUserId) {
            return;
        }
        const currentFriend = useFriendRosterStore.getState().friendsById[normalizedUserId];
        if (!currentFriend || (isOnlineState(currentFriend) && !currentFriend.pendingOffline)) {
            return;
        }
        applyFriendPatch(normalizedUserId, { ...patch, pendingOffline: false }, patch.state || 'offline');
        recordOnlineFeed({
            type: 'Offline',
            userId: normalizedUserId,
            patch,
            previous,
            location: previous.location,
            time: resolveDuration(previous)
        });
    }, PENDING_OFFLINE_DELAY_MS);
    pendingOfflineTimers.set(normalizedUserId, { ownerUserId, timeoutId });
    useFriendRosterStore.getState().applyFriendPatch({
        userId: normalizedUserId,
        patch: { pendingOffline: true },
        stateBucket: 'online'
    });
    return true;
}

function publishFeedEntry(entry, databaseMethod) {
    if (!entry || !databaseMethod || typeof database[databaseMethod] !== 'function') {
        return;
    }
    void (async () => {
        const ownerUserId = currentSessionUserId();
        if (!ownerUserId) {
            return;
        }
        try {
            if (currentSessionUserId() !== ownerUserId) {
                return;
            }
            const scopedDatabaseMethod = `${databaseMethod}ForUser`;
            if (typeof database[scopedDatabaseMethod] !== 'function') {
                return;
            }
            await database[scopedDatabaseMethod](ownerUserId, entry);
            if (currentSessionUserId() !== ownerUserId) {
                return;
            }
            useFeedLiveStore.getState().pushEntry(entry, { ownerUserId });
            void pushSharedFeedNotification(entry).catch((error) => {
                console.warn('Failed to publish shared feed notification:', error);
            });
        } catch (error) {
            console.error(error);
        }
    })();
}

function recordOnlineFeed({ type, userId, patch = {}, previous = {}, location, time = '' }) {
    if (!isRealLocation(location)) {
        return;
    }
    const { worldName, groupName } = resolveLocationName(location, patch, previous);
    publishFeedEntry(
        {
            ...buildFeedBase({ type, userId, patch, previous }),
            location,
            worldName,
            groupName,
            time
        },
        'addOnlineOfflineToDatabase'
    );
}

function recordGpsFeed({ userId, patch = {}, previous = {}, location }) {
    const previousLocation = typeof previous?.location === 'string' ? previous.location.trim() : '';
    if (!isRealLocation(previousLocation) || !isRealLocation(location) || previousLocation === location) {
        return;
    }
    const { worldName, groupName } = resolveLocationName(location, patch, previous);
    publishFeedEntry(
        {
            ...buildFeedBase({ type: 'GPS', userId, patch, previous }),
            location,
            worldName,
            groupName,
            previousLocation,
            time: resolveDuration(previous)
        },
        'addGPSToDatabase'
    );
}

function recordProfileDiffFeed({ userId, patch = {}, previous = {} }) {
    if (!previous || !isOnlineState(previous)) {
        return;
    }

    const statusChanged =
        Object.prototype.hasOwnProperty.call(patch, 'status') &&
        patch.status !== previous.status &&
        patch.status !== 'offline' &&
        previous.status !== 'offline';
    const statusDescriptionChanged =
        Object.prototype.hasOwnProperty.call(patch, 'statusDescription') &&
        patch.statusDescription !== previous.statusDescription;
    if (statusChanged || statusDescriptionChanged) {
        publishFeedEntry(
            {
                ...buildFeedBase({ type: 'Status', userId, patch, previous }),
                status: patch.status ?? previous.status ?? '',
                statusDescription: patch.statusDescription ?? previous.statusDescription ?? '',
                previousStatus: previous.status ?? '',
                previousStatusDescription: previous.statusDescription ?? ''
            },
            'addStatusToDatabase'
        );
    }

    if (
        Object.prototype.hasOwnProperty.call(patch, 'bio') &&
        patch.bio &&
        previous.bio &&
        patch.bio !== previous.bio
    ) {
        publishFeedEntry(
            {
                ...buildFeedBase({ type: 'Bio', userId, patch, previous }),
                bio: patch.bio,
                previousBio: previous.bio
            },
            'addBioToDatabase'
        );
    }

    const currentAvatarImageUrl =
        patch.currentAvatarImageUrl || patch.currentAvatarThumbnailImageUrl || '';
    const previousAvatarImageUrl =
        previous.currentAvatarImageUrl || previous.currentAvatarThumbnailImageUrl || '';
    if (currentAvatarImageUrl !== previousAvatarImageUrl) {
        const entry = {
            ...buildFeedBase({ type: 'Avatar', userId, patch, previous }),
            ownerId: patch.currentAvatarAuthorId || patch.authorId || '',
            previousOwnerId: previous.currentAvatarAuthorId || previous.authorId || '',
            avatarName: patch.currentAvatarName || patch.avatarName || '',
            previousAvatarName: previous.currentAvatarName || previous.avatarName || '',
            currentAvatarImageUrl: patch.currentAvatarImageUrl || '',
            currentAvatarThumbnailImageUrl: patch.currentAvatarThumbnailImageUrl || '',
            previousCurrentAvatarImageUrl: previous.currentAvatarImageUrl || '',
            previousCurrentAvatarThumbnailImageUrl: previous.currentAvatarThumbnailImageUrl || ''
        };
        if (shouldRecordAvatarChange(currentAvatarImageUrl, previousAvatarImageUrl)) {
            publishFeedEntry(entry, 'addAvatarToDatabase');
        } else if (!logEmptyAvatarsLoaded && !previousAvatarImageUrl && logEmptyAvatarsLoadPromise) {
            void logEmptyAvatarsLoadPromise.then(() => {
                if (logEmptyAvatars) {
                    publishFeedEntry(entry, 'addAvatarToDatabase');
                }
            });
        }
    }
}

function patchCurrentUserSnapshot(patch) {
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = runtimeStore.auth.currentUserSnapshot;
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    Object.assign(snapshot, patch);
    runtimeStore.setAuthBootstrap({
        currentUserDisplayName: getDisplayName(snapshot),
        currentUserSnapshot: snapshot
    });
}

function syncCurrentUserFriendState(userId, stateBucket) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return;
    }
    const nextStateBucket = normalizeStateBucket(stateBucket) || 'offline';

    const runtimeStore = useRuntimeStore.getState();
    const snapshot = runtimeStore.auth.currentUserSnapshot;
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    snapshot.friends = ensureArrayMembership(snapshot.friends, normalizedUserId);
    snapshot.onlineFriends = removeFromArray(snapshot.onlineFriends, normalizedUserId);
    snapshot.activeFriends = removeFromArray(snapshot.activeFriends, normalizedUserId);
    snapshot.offlineFriends = removeFromArray(snapshot.offlineFriends, normalizedUserId);

    if (nextStateBucket === 'online') {
        snapshot.onlineFriends = ensureArrayMembership(
            snapshot.onlineFriends,
            normalizedUserId
        );
    } else if (nextStateBucket === 'active') {
        snapshot.activeFriends = ensureArrayMembership(
            snapshot.activeFriends,
            normalizedUserId
        );
    } else {
        snapshot.offlineFriends = ensureArrayMembership(
            snapshot.offlineFriends,
            normalizedUserId
        );
    }

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: snapshot
    });
}

function removeCurrentUserFriend(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return;
    }

    const runtimeStore = useRuntimeStore.getState();
    const snapshot = runtimeStore.auth.currentUserSnapshot;
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    snapshot.friends = removeFromArray(snapshot.friends, normalizedUserId);
    snapshot.onlineFriends = removeFromArray(snapshot.onlineFriends, normalizedUserId);
    snapshot.activeFriends = removeFromArray(snapshot.activeFriends, normalizedUserId);
    snapshot.offlineFriends = removeFromArray(snapshot.offlineFriends, normalizedUserId);

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: snapshot
    });
}

function applyFriendPatch(userId, patch, stateBucket) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return false;
    }

    useFriendRosterStore.getState().applyFriendPatch({
        userId: normalizedUserId,
        patch,
        stateBucket
    });
    syncCurrentUserFriendState(normalizedUserId, stateBucket);
    return true;
}

function notifyFriendLogMenu() {
    useShellStore.getState().notifyMenu('friend-log');
}

export function handleRealtimePresenceEvent(message) {
    const type = typeof message?.type === 'string' ? message.type : '';
    const content = message?.content && typeof message.content === 'object'
        ? message.content
        : null;

    if (!type || !content) {
        return false;
    }

    switch (type) {
    case 'notification':
    case 'notification-v2':
    case 'notification-v2-delete':
    case 'notification-v2-update':
    case 'see-notification':
    case 'hide-notification':
    case 'response-notification':
        return handleRealtimeNotificationEvent(type, content);
    case 'friend-add': {
        const userId = normalizeUserId(content.userId || content.user?.id);
        const userPatch = sanitizeTransportUser(content.user) ?? { id: userId };
        const previous = useFriendRosterStore.getState().friendsById[userId] ?? null;
        const currentStateBucket = resolveStateBucketFromEvent(content, userPatch, previous);
        const changed = applyFriendPatch(userId, userPatch, currentStateBucket);
        if (changed) {
            notifyFriendLogMenu();
        }
        return changed;
    }
    case 'friend-delete': {
        const userId = normalizeUserId(content.userId);
        if (!userId) {
            return false;
        }
        cancelPendingOffline(userId);
        useFriendRosterStore.getState().removeFriend(userId);
        removeCurrentUserFriend(userId);
        notifyFriendLogMenu();
        return true;
    }
    case 'friend-update': {
        const userId = normalizeUserId(content.user?.id || content.userId);
        const userPatch = sanitizeTransportUser(content.user) ?? {};
        if (!userId || (!Object.keys(userPatch).length && !hasEventStateBucket(content))) {
            return false;
        }
        const previous = useFriendRosterStore.getState().friendsById[userId] ?? null;
        const stateBucket = resolveStateBucketFromEvent(content, userPatch, previous);
        const patch = { ...userPatch, id: userId };
        recordProfileDiffFeed({ userId, patch, previous });
        return applyFriendPatch(userId, patch, stateBucket);
    }
    case 'friend-online': {
        const userId = normalizeUserId(content.userId || content.user?.id);
        if (!userId) {
            return false;
        }
        const canceledPendingOffline = cancelPendingOffline(userId);
        const previous = useFriendRosterStore.getState().friendsById[userId] ?? null;
        const userPatch = sanitizeTransportUser(content.user) ?? {};
        const eventLocation = firstString(userPatch.location, content.location);
        const eventTravelingToLocation = firstString(userPatch.travelingToLocation, content.travelingToLocation);
        const eventWorldId = firstString(userPatch.worldId, content.worldId);
        const patch = {
            ...userPatch,
            id: userId,
            platform: content.platform,
            state: 'online',
            pendingOffline: false,
            ...buildLocationPatch(eventLocation, eventTravelingToLocation, eventWorldId, onlinePresenceFallback(previous)),
            locationUpdatedAt: Date.now(),
            $location_at: Date.now()
        };
        if (!canceledPendingOffline && !isOnlineState(previous)) {
            recordOnlineFeed({
                type: 'Online',
                userId,
                patch,
                previous,
                location: patch.location,
                time: ''
            });
        } else {
            recordGpsFeed({ userId, patch, previous, location: patch.location });
        }
        return applyFriendPatch(userId, patch, 'online');
    }
    case 'friend-active': {
        const userId = normalizeUserId(content.userId || content.user?.id);
        if (!userId) {
            return false;
        }
        const previous = useFriendRosterStore.getState().friendsById[userId] ?? null;
        const patch = {
            ...(sanitizeTransportUser(content.user) ?? {}),
            id: userId,
            platform: content.platform,
            state: 'active',
            ...buildLocationPatch('offline', 'offline', 'offline')
        };
        if (scheduleOfflineFeed({ userId, patch, previous })) {
            return true;
        }
        return applyFriendPatch(userId, patch, 'active');
    }
    case 'friend-offline': {
        const userId = normalizeUserId(content.userId);
        if (!userId) {
            return false;
        }
        const previous = useFriendRosterStore.getState().friendsById[userId] ?? null;
        const patch = {
            id: userId,
            platform: content.platform,
            state: 'offline',
            ...buildLocationPatch('offline', 'offline', 'offline')
        };
        if (scheduleOfflineFeed({ userId, patch, previous })) {
            return true;
        }
        return applyFriendPatch(userId, patch, 'offline');
    }
    case 'friend-location': {
        const userId = normalizeUserId(content.userId || content.user?.id);
        if (!userId) {
            return false;
        }
        cancelPendingOffline(userId);
        const previous = useFriendRosterStore.getState().friendsById[userId] ?? null;
        const userPatch = sanitizeTransportUser(content.user) ?? {};
        const eventLocation = firstString(userPatch.location, content.location);
        const eventTravelingToLocation = firstString(userPatch.travelingToLocation, content.travelingToLocation);
        const eventWorldId = firstString(userPatch.worldId, content.worldId);
        const patch = {
            ...userPatch,
            id: userId,
            state: 'online',
            pendingOffline: false,
            ...buildLocationPatch(eventLocation, eventTravelingToLocation, eventWorldId, onlinePresenceFallback(previous)),
            locationUpdatedAt: Date.now(),
            $location_at: Date.now()
        };
        recordGpsFeed({ userId, patch, previous, location: patch.location });
        return applyFriendPatch(userId, patch, 'online');
    }
    case 'user-update': {
        const previous = useRuntimeStore.getState().auth.currentUserSnapshot ?? null;
        const userPatch = sanitizeTransportUser(content.user, { preserveState: true }) ?? {};
        const stateBucket = resolveStateBucketFromEvent(content, userPatch, previous, '');
        const patch = { ...userPatch };
        if (stateBucket) {
            patch.stateBucket = stateBucket;
        }
        if (!Object.keys(patch).length) {
            return false;
        }
        patchCurrentUserSnapshot(patch);
        return true;
    }
    case 'user-location': {
        const currentUserId = normalizeUserId(useRuntimeStore.getState().auth.currentUserId);
        const userId = normalizeUserId(content.userId);
        if (!currentUserId || !userId || currentUserId !== userId) {
            return false;
        }
        patchCurrentUserSnapshot(
            buildLocationPatch(
                content.location,
                content.travelingToLocation,
                content.worldId,
                useRuntimeStore.getState().auth.currentUserSnapshot
            )
        );
        return true;
    }
    default:
        return false;
    }
}
