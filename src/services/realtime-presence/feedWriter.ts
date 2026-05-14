import { feedRepository } from '@/repositories/index.js';
import { useFeedLiveStore } from '@/state/feedLiveStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { pushSharedFeedNotification } from '../sharedFeedFilterService.js';
import { showSQLiteErrorDialog } from '../sqliteErrorDialogService.js';
import {
    isOnlineState,
    isRealLocation,
    normalizeUserId,
    resolveDuration,
    resolveFeedDisplayName,
    resolveGpsDuration,
    resolveGpsPreviousLocation,
    resolveLocationName
} from './helpers.js';

const PENDING_OFFLINE_DELAY_MS = 170000;
const pendingOfflineTimers = new Map<string, Record<string, any>>();

function currentSessionUserId() {
    return normalizeUserId(useRuntimeStore.getState().auth.currentUserId);
}

function cancelPendingOffline(userId: unknown) {
    const normalizedUserId = normalizeUserId(userId);
    const pending = pendingOfflineTimers.get(normalizedUserId);
    if (!pending) {
        return false;
    }
    clearTimeout(pending.timeoutId);
    pendingOfflineTimers.delete(normalizedUserId);
    return true;
}

function scheduleOfflineFeed({
    userId,
    patch = {},
    previous = {},
    applyFriendPatch
}: Record<string, any>) {
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

function buildFeedBase({ type, userId, patch = {}, previous = {} }: Record<string, any>) {
    return {
        created_at: new Date().toJSON(),
        type,
        userId,
        displayName: resolveFeedDisplayName(userId, patch, previous)
    };
}

function publishFeedEntry(entry: Record<string, any>, databaseMethod: string) {
    const feedWriterByMethod = {
        addAvatarToDatabase:
            feedRepository.addAvatarEntryForUser.bind(feedRepository),
        addBioToDatabase:
            feedRepository.addBioEntryForUser.bind(feedRepository),
        addGPSToDatabase:
            feedRepository.addGpsEntryForUser.bind(feedRepository),
        addOnlineOfflineToDatabase:
            feedRepository.addOnlineOfflineEntryForUser.bind(feedRepository),
        addStatusToDatabase:
            feedRepository.addStatusEntryForUser.bind(feedRepository)
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
            await showSQLiteErrorDialog(error);
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
}: Record<string, any>) {
    const normalizedLocation =
        typeof location === 'string' ? location.trim() : '';
    const { worldName, groupName } = isRealLocation(normalizedLocation)
        ? resolveLocationName(normalizedLocation, patch, previous)
        : { worldName: '', groupName: '' };
    publishFeedEntry(
        {
            ...buildFeedBase({ type, userId, patch, previous }),
            location: normalizedLocation,
            worldName,
            groupName,
            time
        },
        'addOnlineOfflineToDatabase'
    );
}

function recordGpsFeed({ userId, patch = {}, previous = {}, location }: Record<string, any>) {
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

function recordProfileDiffFeed({ userId, patch = {}, previous = {} }: Record<string, any>) {
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
        if (previousAvatarImageUrl) {
            publishFeedEntry(entry, 'addAvatarToDatabase');
        }
    }
}

export {
    cancelPendingOffline,
    currentSessionUserId,
    recordGpsFeed,
    recordOnlineFeed,
    recordProfileDiffFeed,
    scheduleOfflineFeed
};
