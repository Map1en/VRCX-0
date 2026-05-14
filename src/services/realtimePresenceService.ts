import { configRepository } from '@/repositories/index.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';

import {
    buildAvatarWearSnapshotUpdate,
    persistAvatarWearTransition
} from './avatarWearTimeService.js';
import { refreshCurrentUser } from './backgroundMaintenanceService.js';
import {
    recordCurrentUserSnapshot,
    recordFriendPatch
} from './domainIngestionService.js';
import {
    recordFriendLogFriendByUserId,
    recordFriendLogUnfriendByUserId
} from './friendBootstrapService.js';
import { applyCurrentUserLocationEvent } from './realtime-presence/currentUserLocationFallback.js';
import { dispatchRealtimePresenceMessage } from './realtime-presence/dispatcher.js';
import {
    cancelPendingOffline,
    recordGpsFeed,
    recordOnlineFeed,
    recordProfileDiffFeed,
    scheduleOfflineFeed
} from './realtime-presence/feedWriter.js';
import {
    buildLocationMetadataPatch,
    buildLocationPatch,
    ensureArrayMembership,
    firstString,
    getCurrentUserSnapshot,
    hasEventStateBucket,
    isOnlineState,
    normalizeStateBucket,
    normalizeUserId,
    onlinePresenceFallback,
    removeFromArray,
    resolveStateBucketFromEvent,
    sanitizeTransportUser,
    setCurrentUserSnapshot
} from './realtime-presence/helpers.js';
import { handleInstanceClosedEvent } from './realtime-presence/notifications.js';
import { handleRealtimeNotificationEvent } from './vrcNotificationRuntimeService.js';

function patchCurrentUserSnapshot(patch) {
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = getCurrentUserSnapshot(runtimeStore);
    if (!snapshot) {
        return;
    }

    const { snapshot: nextSnapshot, transition } =
        buildAvatarWearSnapshotUpdate({
            previousSnapshot: snapshot,
            nextSnapshot: { ...snapshot, ...patch },
            isGameRunning: runtimeStore.gameState.isGameRunning,
            userId: runtimeStore.auth.currentUserId
        });

    setCurrentUserSnapshot(runtimeStore, nextSnapshot);
    persistAvatarWearTransition(transition);
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
    recordCurrentUserSnapshot(nextSnapshot, {
        endpoint: runtimeStore.auth.currentUserEndpoint,
        source: 'currentUser'
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

    const nextSnapshot = { ...snapshot };
    for (const key of [
        'friends',
        'onlineFriends',
        'activeFriends',
        'offlineFriends'
    ]) {
        if (Array.isArray(snapshot[key])) {
            nextSnapshot[key] = removeFromArray(snapshot[key], normalizedUserId);
        }
    }

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: nextSnapshot
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
    recordFriendPatch({
        endpoint: useRuntimeStore.getState().auth.currentUserEndpoint,
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

async function isGameLogDisabled() {
    const preferencesState = usePreferencesStore.getState();
    if (preferencesState.preferencesHydrated) {
        return Boolean(preferencesState.gameLogDisabled);
    }
    try {
        return Boolean(
            await configRepository.getBool('gameLogDisabled', false)
        );
    } catch {
        return false;
    }
}

export async function handleRealtimePresenceEvent(message) {
    return dispatchRealtimePresenceMessage(message, {
        notification: handleRealtimeNotificationEvent,
        default: async (content, type) => {
            switch (type) {
                case 'friend-add': {
                    const userId = normalizeUserId(
                        content.userId || content.user?.id
                    );
                    const userPatch = sanitizeTransportUser(content.user) ?? {
                        id: userId
                    };
                    const previous =
                        useFriendRosterStore.getState().friendsById[userId] ??
                        null;
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
                    let historyCount = 0;
                    try {
                        const runtimeState = useRuntimeStore.getState();
                        const result = (await recordFriendLogFriendByUserId({
                            currentUserId: runtimeState.auth.currentUserId,
                            targetUserId: userId,
                            targetUser: userPatch,
                            stateBucket: currentStateBucket
                        })) as Record<string, any>;
                        historyCount = result?.historyCount ?? 0;
                    } catch (error) {
                        console.warn(
                            'Friend log add recording failed:',
                            error
                        );
                    }
                    if (changed || historyCount > 0) {
                        notifyFriendLogMenu();
                    }
                    return changed || historyCount > 0;
                }
                case 'friend-delete': {
                    const userId = normalizeUserId(content.userId);
                    if (!userId) {
                        return false;
                    }
                    cancelPendingOffline(userId);
                    useFriendRosterStore.getState().removeFriend(userId);
                    removeCurrentUserFriend(userId);
                    try {
                        const runtimeState = useRuntimeStore.getState();
                        await recordFriendLogUnfriendByUserId({
                            currentUserId: runtimeState.auth.currentUserId,
                            targetUserId: userId
                        });
                    } catch (error) {
                        console.warn(
                            'Friend log unfriend recording failed:',
                            error
                        );
                    }
                    notifyFriendLogMenu();
                    return true;
                }
                case 'friend-update': {
                    const userId = normalizeUserId(
                        content.user?.id || content.userId
                    );
                    const userPatch = sanitizeTransportUser(content.user) ?? {};
                    if (
                        !userId ||
                        (!Object.keys(userPatch).length &&
                            !hasEventStateBucket(content))
                    ) {
                        return false;
                    }
                    const previous =
                        useFriendRosterStore.getState().friendsById[userId] ??
                        null;
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
                    const userId = normalizeUserId(
                        content.userId || content.user?.id
                    );
                    if (!userId) {
                        return false;
                    }
                    const canceledPendingOffline = cancelPendingOffline(userId);
                    const previous =
                        useFriendRosterStore.getState().friendsById[userId] ??
                        null;
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
                    const userId = normalizeUserId(
                        content.userId || content.user?.id
                    );
                    if (!userId) {
                        return false;
                    }
                    const previous =
                        useFriendRosterStore.getState().friendsById[userId] ??
                        null;
                    const patch = {
                        ...(sanitizeTransportUser(content.user) ?? {}),
                        id: userId,
                        platform: content.platform,
                        state: 'active',
                        ...buildLocationPatch('offline', 'offline', 'offline')
                    };
                    if (
                        scheduleOfflineFeed({
                            userId,
                            patch,
                            previous,
                            applyFriendPatch
                        })
                    ) {
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
                        useFriendRosterStore.getState().friendsById[userId] ??
                        null;
                    const patch = {
                        id: userId,
                        platform: content.platform,
                        state: 'offline',
                        ...buildLocationPatch('offline', 'offline', 'offline')
                    };
                    if (
                        scheduleOfflineFeed({
                            userId,
                            patch,
                            previous,
                            applyFriendPatch
                        })
                    ) {
                        return true;
                    }
                    return applyFriendPatch(userId, patch, 'offline');
                }
                case 'friend-location': {
                    const userId = normalizeUserId(
                        content.userId || content.user?.id
                    );
                    if (!userId) {
                        return false;
                    }
                    cancelPendingOffline(userId);
                    const previous =
                        useFriendRosterStore.getState().friendsById[userId] ??
                        null;
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
                    const runtimeState = useRuntimeStore.getState();
                    const previous = runtimeState.auth.currentUserSnapshot ?? null;
                    const userPatch =
                        sanitizeTransportUser(content.user, {
                            preserveState: true
                        }) ?? {};
                    const currentUserId = normalizeUserId(
                        runtimeState.auth.currentUserId
                    );
                    const eventUserId = normalizeUserId(
                        userPatch.id || content.userId
                    );
                    if (!currentUserId || !eventUserId) {
                        return false;
                    }
                    if (eventUserId !== currentUserId) {
                        return false;
                    }
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
                    try {
                        await refreshCurrentUser({
                            expectedUserId: currentUserId,
                            expectedEndpoint:
                                runtimeState.auth.currentUserEndpoint,
                            expectedWebsocket:
                                runtimeState.auth.currentUserWebsocket,
                            overlayPatch: patch
                        });
                    } catch (error) {
                        console.warn(
                            'Current user refresh after realtime update failed:',
                            error
                        );
                    }
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
                    return applyCurrentUserLocationEvent(content, {
                        isGameLogDisabled,
                        patchCurrentUserSnapshot
                    });
                }
                case 'instance-closed': {
                    return handleInstanceClosedEvent(content);
                }
                default:
                    return false;
            }
        }
    });
}
