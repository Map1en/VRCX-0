import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import {
    configRepository,
    feedRepository,
    gameLogRepository
} from '@/repositories/index.js';
import { buildCurrentUserGameStatePresencePatch } from '@/shared/utils/currentUserPresence.js';
import { createLocationEntry } from '@/shared/utils/gameLog.js';
import { isRealInstance } from '@/shared/utils/instance.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFeedLiveStore } from '@/state/feedLiveStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';

import { pushSharedFeedNotification } from './sharedFeedFilterService.js';
import { handleRealtimeNotificationEvent } from './vrcNotificationRuntimeService.js';

const PENDING_OFFLINE_DELAY_MS = 170000;
const UNKNOWN_FEED_USER_DISPLAY_NAME = 'Unknown';
const pendingOfflineTimers = new Map();
let logEmptyAvatars = false;
let logEmptyAvatarsLoaded = false;
let logEmptyAvatarsLoadPromise = null;
let unsubscribeLogEmptyAvatars = null;

function normalizeUserId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeStateBucket(value) {
    const normalized = normalizeUserId(value).toLowerCase();
    if (
        normalized === 'online' ||
        normalized === 'active' ||
        normalized === 'offline'
    ) {
        return normalized;
    }
    return '';
}

function resolveStateBucketFromEvent(
    content,
    patch,
    previous,
    fallback = 'offline'
) {
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

function getCurrentUserSnapshot(runtimeStore) {
    const snapshot = runtimeStore.auth.currentUserSnapshot;
    return snapshot && typeof snapshot === 'object' ? snapshot : null;
}

function setCurrentUserSnapshot(runtimeStore, snapshot) {
    runtimeStore.setAuthBootstrap({
        currentUserDisplayName: getDisplayName(snapshot),
        currentUserSnapshot: snapshot
    });
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return '';
}

function buildLocationPatch(
    location,
    travelingToLocation,
    worldId,
    fallback = {}
) {
    const normalizedLocation = firstString(
        location,
        fallback.location,
        fallback.$location?.tag
    );
    const normalizedTraveling = firstString(
        travelingToLocation,
        fallback.travelingToLocation,
        fallback.$travelingToLocation?.tag
    );
    const parsedLocation = parseLocation(normalizedLocation);
    const parsedTraveling = parseLocation(normalizedTraveling);

    return {
        location: normalizedLocation,
        worldId: firstString(worldId, parsedLocation.worldId, fallback.worldId),
        instanceId: parsedLocation.instanceId || '',
        travelingToLocation: normalizedTraveling,
        travelingToWorld: parsedTraveling.worldId || '',
        travelingToInstance: parsedTraveling.instanceId || '',
        $location: parsedLocation,
        $travelingToLocation: parsedTraveling
    };
}

function onlinePresenceFallback(previous) {
    const location = firstString(
        previous?.location,
        previous?.$location?.tag
    ).toLowerCase();
    if (!location || location === 'offline' || location === 'offline:offline') {
        return {};
    }
    return previous;
}

function isRealLocation(location) {
    const value = typeof location === 'string' ? location.trim() : '';
    return Boolean(
        value &&
        value !== 'offline' &&
        value !== 'offline:offline' &&
        value !== 'traveling' &&
        value !== 'private'
    );
}

function isTravelingLocation(location) {
    return (
        typeof location === 'string' &&
        location.trim().toLowerCase() === 'traveling'
    );
}

function isOnlineState(row) {
    return normalizeStateBucket(row?.stateBucket || row?.state) === 'online';
}

function initLogEmptyAvatarsPreference() {
    if (unsubscribeLogEmptyAvatars) {
        return;
    }
    unsubscribeLogEmptyAvatars = onPreferenceChanged(
        'logEmptyAvatars',
        (value) => {
            logEmptyAvatars = Boolean(value);
            logEmptyAvatarsLoaded = true;
            logEmptyAvatarsLoadPromise = null;
        }
    );
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

function shouldRecordAvatarChange(
    currentAvatarImageUrl,
    previousAvatarImageUrl
) {
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
        worldName:
            patch.worldName ||
            patch.world?.name ||
            previous.worldName ||
            parsed.worldId ||
            location ||
            '',
        groupName: patch.groupName || previous.groupName || parsed.groupId || ''
    };
}

function resolveDuration(previous) {
    const timestamp = Number(
        previous?.locationUpdatedAt || previous?.$location_at || 0
    );
    return timestamp > 0 ? Date.now() - timestamp : '';
}

function resolveGpsPreviousLocation(previous = {}) {
    const previousLocation =
        typeof previous?.location === 'string' ? previous.location.trim() : '';
    if (isTravelingLocation(previousLocation)) {
        return firstString(previous.$previousLocation);
    }
    return previousLocation;
}

function resolveGpsDuration(previous = {}) {
    if (isTravelingLocation(previous?.location)) {
        const previousLocationTimestamp = Number(
            previous?.$previousLocation_at || 0
        );
        return previousLocationTimestamp > 0
            ? Date.now() - previousLocationTimestamp
            : '';
    }
    return resolveDuration(previous);
}

function buildLocationMetadataPatch(location, previous = {}, timestamp) {
    if (isTravelingLocation(location)) {
        if (isTravelingLocation(previous?.location)) {
            return {};
        }
        const previousLocation = firstString(
            previous?.location,
            previous?.$location?.tag
        );
        const previousLocationTimestamp =
            previous?.locationUpdatedAt || previous?.$location_at || 0;
        const metadata = {
            locationUpdatedAt: timestamp,
            $location_at: timestamp,
            $travelingToTime: timestamp,
            travelingToTime: timestamp
        };
        if (isRealLocation(previousLocation)) {
            metadata.$previousLocation = previousLocation;
            metadata.$previousLocation_at = previousLocationTimestamp;
        }
        return metadata;
    }

    const previousTravelLocation = firstString(previous?.$previousLocation);
    const previousLocationTimestamp = Number(
        previous?.$previousLocation_at || 0
    );
    const returnedToPreviousLocation =
        previousTravelLocation && previousTravelLocation === location;
    const locationTimestamp =
        returnedToPreviousLocation && previousLocationTimestamp > 0
            ? previousLocationTimestamp
            : timestamp;

    return {
        locationUpdatedAt: locationTimestamp,
        $location_at: locationTimestamp,
        $previousLocation: '',
        $previousLocation_at: '',
        $travelingToTime: '',
        travelingToTime: ''
    };
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
        const currentFriend =
            useFriendRosterStore.getState().friendsById[normalizedUserId];
        if (
            !currentFriend ||
            (isOnlineState(currentFriend) && !currentFriend.pendingOffline)
        ) {
            return;
        }
        applyFriendPatch(
            normalizedUserId,
            { ...patch, pendingOffline: false },
            patch.state || 'offline'
        );
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
    const feedWriterByMethod = {
        addAvatarToDatabase: feedRepository.addAvatarEntryForUser.bind(
            feedRepository
        ),
        addBioToDatabase: feedRepository.addBioEntryForUser.bind(
            feedRepository
        ),
        addGPSToDatabase: feedRepository.addGpsEntryForUser.bind(
            feedRepository
        ),
        addOnlineOfflineToDatabase:
            feedRepository.addOnlineOfflineEntryForUser.bind(feedRepository),
        addStatusToDatabase: feedRepository.addStatusEntryForUser.bind(
            feedRepository
        )
    };
    const feedWriter = feedWriterByMethod[databaseMethod];
    if (!entry || typeof feedWriter !== 'function') {
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
            await feedWriter(ownerUserId, entry);
            if (currentSessionUserId() !== ownerUserId) {
                return;
            }
            useFeedLiveStore.getState().pushEntry(entry, { ownerUserId });
            void pushSharedFeedNotification(entry).catch((error) => {
                console.warn(
                    'Failed to publish shared feed notification:',
                    error
                );
            });
        } catch (error) {
            console.error(error);
        }
    })();
}

function recordOnlineFeed({
    type,
    userId,
    patch = {},
    previous = {},
    location,
    time = ''
}) {
    if (!isRealLocation(location)) {
        return;
    }
    const { worldName, groupName } = resolveLocationName(
        location,
        patch,
        previous
    );
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
    const previousLocation = resolveGpsPreviousLocation(previous);
    if (
        !isRealLocation(previousLocation) ||
        !isRealLocation(location) ||
        previousLocation === location
    ) {
        return;
    }
    const { worldName, groupName } = resolveLocationName(
        location,
        patch,
        previous
    );
    publishFeedEntry(
        {
            ...buildFeedBase({ type: 'GPS', userId, patch, previous }),
            location,
            worldName,
            groupName,
            previousLocation,
            time: resolveGpsDuration(previous)
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
                statusDescription:
                    patch.statusDescription ?? previous.statusDescription ?? '',
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
        patch.currentAvatarImageUrl ||
        patch.currentAvatarThumbnailImageUrl ||
        '';
    const previousAvatarImageUrl =
        previous.currentAvatarImageUrl ||
        previous.currentAvatarThumbnailImageUrl ||
        '';
    if (currentAvatarImageUrl !== previousAvatarImageUrl) {
        const entry = {
            ...buildFeedBase({ type: 'Avatar', userId, patch, previous }),
            ownerId: patch.currentAvatarAuthorId || patch.authorId || '',
            previousOwnerId:
                previous.currentAvatarAuthorId || previous.authorId || '',
            avatarName: patch.currentAvatarName || patch.avatarName || '',
            previousAvatarName:
                previous.currentAvatarName || previous.avatarName || '',
            currentAvatarImageUrl: patch.currentAvatarImageUrl || '',
            currentAvatarThumbnailImageUrl:
                patch.currentAvatarThumbnailImageUrl || '',
            previousCurrentAvatarImageUrl: previous.currentAvatarImageUrl || '',
            previousCurrentAvatarThumbnailImageUrl:
                previous.currentAvatarThumbnailImageUrl || ''
        };
        if (
            shouldRecordAvatarChange(
                currentAvatarImageUrl,
                previousAvatarImageUrl
            )
        ) {
            publishFeedEntry(entry, 'addAvatarToDatabase');
        } else if (
            !logEmptyAvatarsLoaded &&
            !previousAvatarImageUrl &&
            logEmptyAvatarsLoadPromise
        ) {
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
    const snapshot = getCurrentUserSnapshot(runtimeStore);
    if (!snapshot) {
        return;
    }

    setCurrentUserSnapshot(runtimeStore, { ...snapshot, ...patch });
}

function syncCurrentUserFriendState(userId, stateBucket) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return;
    }
    const nextStateBucket = normalizeStateBucket(stateBucket) || 'offline';

    const runtimeStore = useRuntimeStore.getState();
    const snapshot = getCurrentUserSnapshot(runtimeStore);
    if (!snapshot) {
        return;
    }

    const nextSnapshot = {
        ...snapshot,
        friends: ensureArrayMembership(snapshot.friends, normalizedUserId),
        onlineFriends: removeFromArray(
            snapshot.onlineFriends,
            normalizedUserId
        ),
        activeFriends: removeFromArray(
            snapshot.activeFriends,
            normalizedUserId
        ),
        offlineFriends: removeFromArray(
            snapshot.offlineFriends,
            normalizedUserId
        )
    };

    if (nextStateBucket === 'online') {
        nextSnapshot.onlineFriends = ensureArrayMembership(
            nextSnapshot.onlineFriends,
            normalizedUserId
        );
    } else if (nextStateBucket === 'active') {
        nextSnapshot.activeFriends = ensureArrayMembership(
            nextSnapshot.activeFriends,
            normalizedUserId
        );
    } else {
        nextSnapshot.offlineFriends = ensureArrayMembership(
            nextSnapshot.offlineFriends,
            normalizedUserId
        );
    }

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: nextSnapshot
    });
}

function removeCurrentUserFriend(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return;
    }

    const runtimeStore = useRuntimeStore.getState();
    const snapshot = getCurrentUserSnapshot(runtimeStore);
    if (!snapshot) {
        return;
    }

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: {
            ...snapshot,
            friends: removeFromArray(snapshot.friends, normalizedUserId),
            onlineFriends: removeFromArray(
                snapshot.onlineFriends,
                normalizedUserId
            ),
            activeFriends: removeFromArray(
                snapshot.activeFriends,
                normalizedUserId
            ),
            offlineFriends: removeFromArray(
                snapshot.offlineFriends,
                normalizedUserId
            )
        }
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

function parseStringArray(value) {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string');
    }
    if (typeof value !== 'string') {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((entry) => typeof entry === 'string')
            : [];
    } catch {
        return [];
    }
}

async function shouldNotifyInstanceClosed() {
    try {
        const filters = parseStringArray(
            await configRepository.getString(
                'VRCX_notificationTableFilters',
                '[]'
            )
        );
        return !filters.length || filters.includes('instance.closed');
    } catch {
        return true;
    }
}

async function isGameLogDisabled() {
    const preferencesState = usePreferencesStore.getState();
    if (preferencesState.preferencesHydrated) {
        return Boolean(preferencesState.gameLogDisabled);
    }
    try {
        return Boolean(await configRepository.getBool('gameLogDisabled', false));
    } catch {
        return false;
    }
}

function patchCurrentUserSnapshotFromGameState(runtimeStore) {
    const currentSnapshot = getCurrentUserSnapshot(runtimeStore);
    if (!currentSnapshot) {
        return false;
    }
    const presencePatch = buildCurrentUserGameStatePresencePatch(
        runtimeStore.gameState,
        currentSnapshot
    );
    if (!presencePatch) {
        return false;
    }
    const startedAt = Date.parse(
        runtimeStore.gameState.currentLocationStartedAt || ''
    );
    const locationTime = Number.isFinite(startedAt) ? startedAt : Date.now();
    setCurrentUserSnapshot(runtimeStore, {
        ...currentSnapshot,
        ...presencePatch,
        ...(runtimeStore.gameState.currentLocation === 'traveling'
            ? { $travelingToTime: locationTime }
            : { $location_at: locationTime })
    });
    return true;
}

async function updateRealtimeLocationFallback(location) {
    const normalizedLocation = firstString(location);
    const runtimeStore = useRuntimeStore.getState();
    if (!normalizedLocation || runtimeStore.gameState.isGameRunning) {
        return;
    }

    if (!isRealInstance(normalizedLocation)) {
        runtimeStore.setGameState({
            currentLocation: '',
            currentWorldId: '',
            currentWorldName: '',
            currentDestination: '',
            currentLocationStartedAt: null,
            currentLocationPlayerIds: []
        });
        return;
    }

    const createdAt = new Date().toISOString();
    const parsed = parseLocation(normalizedLocation);
    const worldName = parsed.worldId
        ? await gameLogRepository.getWorldNameByWorldId(parsed.worldId)
        : '';
    runtimeStore.setGameState({
        currentLocation: normalizedLocation,
        currentWorldId: parsed.worldId || '',
        currentWorldName: worldName || '',
        currentDestination: '',
        currentLocationStartedAt: createdAt,
        currentLocationPlayerIds: [],
        lastGameLogAt: createdAt,
        lastGameLogType: 'location'
    });

    const latestLocations = await gameLogRepository.lookupGameLogDatabase(
        ['Location'],
        [],
        1
    );
    const latestLocation =
        Array.isArray(latestLocations) && latestLocations.length
            ? firstString(latestLocations[0]?.location)
            : '';
    if (latestLocation === normalizedLocation) {
        return;
    }

    await gameLogRepository.addGamelogLocationToDatabase(
        createLocationEntry(
            createdAt,
            normalizedLocation,
            parsed.worldId || '',
            worldName || ''
        )
    );
}

async function applyCurrentUserLocationEvent(content) {
    const runtimeStore = useRuntimeStore.getState();
    patchCurrentUserSnapshot(
        buildLocationPatch(
            content.location,
            content.travelingToLocation,
            content.worldId,
            runtimeStore.auth.currentUserSnapshot
        )
    );

    if (
        runtimeStore.gameState.isGameRunning &&
        !(await isGameLogDisabled()) &&
        firstString(runtimeStore.gameState.currentLocation)
    ) {
        patchCurrentUserSnapshotFromGameState(useRuntimeStore.getState());
        return true;
    }

    await updateRealtimeLocationFallback(content.location);
    return true;
}

async function handleInstanceClosedEvent(content) {
    const location = firstString(content.instanceLocation, content.location);
    const createdAt = new Date().toISOString();
    const notification = {
        id: `instance.closed:${location || 'unknown'}:${createdAt}`,
        type: 'instance.closed',
        location,
        message: 'Instance Closed',
        createdAt,
        created_at: createdAt
    };
    useVrcNotificationStore.getState().upsertNotification(notification);
    if (await shouldNotifyInstanceClosed()) {
        useShellStore.getState().notifyMenu('notification');
    }
    useFeedLiveStore
        .getState()
        .pushEntry(notification, { ownerUserId: currentSessionUserId() });
    void pushSharedFeedNotification(notification).catch((error) => {
        console.warn(
            'Failed to publish instance-closed shared feed notification:',
            error
        );
    });
    return true;
}

export async function handleRealtimePresenceEvent(message) {
    const type = typeof message?.type === 'string' ? message.type : '';
    const content =
        message?.content && typeof message.content === 'object'
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
            const userPatch = sanitizeTransportUser(content.user) ?? {
                id: userId
            };
            const previous =
                useFriendRosterStore.getState().friendsById[userId] ?? null;
            const currentStateBucket = resolveStateBucketFromEvent(
                content,
                userPatch,
                previous
            );
            const changed = applyFriendPatch(
                userId,
                userPatch,
                currentStateBucket
            );
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
            if (
                !userId ||
                (!Object.keys(userPatch).length &&
                    !hasEventStateBucket(content))
            ) {
                return false;
            }
            const previous =
                useFriendRosterStore.getState().friendsById[userId] ?? null;
            const stateBucket = resolveStateBucketFromEvent(
                content,
                userPatch,
                previous
            );
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
            const previous =
                useFriendRosterStore.getState().friendsById[userId] ?? null;
            const userPatch = sanitizeTransportUser(content.user) ?? {};
            const eventLocation = firstString(
                userPatch.location,
                content.location
            );
            const eventTravelingToLocation = firstString(
                userPatch.travelingToLocation,
                content.travelingToLocation
            );
            const eventWorldId = firstString(
                userPatch.worldId,
                content.worldId
            );
            const locationTimestamp = Date.now();
            const locationPatch = buildLocationPatch(
                eventLocation,
                eventTravelingToLocation,
                eventWorldId,
                onlinePresenceFallback(previous)
            );
            const patch = {
                ...userPatch,
                id: userId,
                platform: content.platform,
                state: 'online',
                pendingOffline: false,
                ...locationPatch,
                ...buildLocationMetadataPatch(
                    locationPatch.location,
                    previous,
                    locationTimestamp
                )
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
                recordGpsFeed({
                    userId,
                    patch,
                    previous,
                    location: patch.location
                });
            }
            return applyFriendPatch(userId, patch, 'online');
        }
        case 'friend-active': {
            const userId = normalizeUserId(content.userId || content.user?.id);
            if (!userId) {
                return false;
            }
            const previous =
                useFriendRosterStore.getState().friendsById[userId] ?? null;
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
            const previous =
                useFriendRosterStore.getState().friendsById[userId] ?? null;
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
            const previous =
                useFriendRosterStore.getState().friendsById[userId] ?? null;
            const userPatch = sanitizeTransportUser(content.user) ?? {};
            const eventLocation = firstString(
                userPatch.location,
                content.location
            );
            const eventTravelingToLocation = firstString(
                userPatch.travelingToLocation,
                content.travelingToLocation
            );
            const eventWorldId = firstString(
                userPatch.worldId,
                content.worldId
            );
            const locationTimestamp = Date.now();
            const locationPatch = buildLocationPatch(
                eventLocation,
                eventTravelingToLocation,
                eventWorldId,
                onlinePresenceFallback(previous)
            );
            const patch = {
                ...userPatch,
                id: userId,
                state: 'online',
                pendingOffline: false,
                ...locationPatch,
                ...buildLocationMetadataPatch(
                    locationPatch.location,
                    previous,
                    locationTimestamp
                )
            };
            recordGpsFeed({
                userId,
                patch,
                previous,
                location: patch.location
            });
            return applyFriendPatch(userId, patch, 'online');
        }
        case 'user-update': {
            const previous =
                useRuntimeStore.getState().auth.currentUserSnapshot ?? null;
            const userPatch =
                sanitizeTransportUser(content.user, { preserveState: true }) ??
                {};
            const stateBucket = resolveStateBucketFromEvent(
                content,
                userPatch,
                previous,
                ''
            );
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
            const currentUserId = normalizeUserId(
                useRuntimeStore.getState().auth.currentUserId
            );
            const userId = normalizeUserId(content.userId);
            if (!currentUserId || !userId || currentUserId !== userId) {
                return false;
            }
            return applyCurrentUserLocationEvent(content);
        }
        case 'instance-closed': {
            return handleInstanceClosedEvent(content);
        }
        default:
            return false;
    }
}
