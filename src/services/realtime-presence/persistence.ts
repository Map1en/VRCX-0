import { useRuntimeStore } from '@/state/runtimeStore.js';

import {
    recordFriendLogFriendByUserId,
    recordFriendLogUnfriendByUserId
} from '../friendBootstrapService.js';
import {
    cancelPendingOffline,
    recordGpsFeed,
    recordOnlineFeed,
    recordProfileDiffFeed,
    scheduleOfflineFeed
} from './feedWriter.js';
import { isOnlineState } from './helpers.js';

type FriendPatchApplier = (
    userId: string,
    patch: Record<string, any>,
    stateBucket: string
) => boolean;

function cancelRealtimeFriendPendingOffline(userId: unknown): boolean {
    return cancelPendingOffline(userId);
}

async function persistRealtimeFriendAdd({
    userId,
    userPatch,
    stateBucket
}: {
    userId: string;
    userPatch: Record<string, any>;
    stateBucket: string;
}): Promise<{ historyCount: number }> {
    try {
        const runtimeState = useRuntimeStore.getState();
        const result = (await recordFriendLogFriendByUserId({
            currentUserId: runtimeState.auth.currentUserId,
            targetUserId: userId,
            targetUser: userPatch,
            stateBucket
        })) as Record<string, any>;
        return {
            historyCount: result?.historyCount ?? 0
        };
    } catch (error) {
        console.warn('Friend log add recording failed:', error);
        return {
            historyCount: 0
        };
    }
}

async function persistRealtimeFriendDelete({
    userId
}: {
    userId: string;
}): Promise<void> {
    try {
        const runtimeState = useRuntimeStore.getState();
        await recordFriendLogUnfriendByUserId({
            currentUserId: runtimeState.auth.currentUserId,
            targetUserId: userId
        });
    } catch (error) {
        console.warn('Friend log unfriend recording failed:', error);
    }
}

function persistRealtimeFriendUpdateFeed({
    userId,
    patch,
    previous
}: {
    userId: string;
    patch: Record<string, any>;
    previous: Record<string, any> | null;
}): void {
    recordProfileDiffFeed({ userId, patch, previous });
}

function persistRealtimeFriendOnlineFeed({
    userId,
    patch,
    previous,
    canceledPendingOffline
}: {
    userId: string;
    patch: Record<string, any>;
    previous: Record<string, any> | null;
    canceledPendingOffline: boolean;
}): void {
    if (!canceledPendingOffline && !isOnlineState(previous)) {
        recordOnlineFeed({
            type: 'Online',
            userId,
            patch,
            previous,
            location: patch.location,
            time: ''
        });
        return;
    }

    recordGpsFeed({
        userId,
        patch,
        previous,
        location: patch.location
    });
}

function persistRealtimeFriendLocationFeed({
    userId,
    patch,
    previous
}: {
    userId: string;
    patch: Record<string, any>;
    previous: Record<string, any> | null;
}): void {
    recordGpsFeed({
        userId,
        patch,
        previous,
        location: patch.location
    });
}

function scheduleRealtimeFriendOfflineFeed({
    userId,
    patch,
    previous,
    applyFriendPatch
}: {
    userId: string;
    patch: Record<string, any>;
    previous: Record<string, any> | null;
    applyFriendPatch: FriendPatchApplier;
}): boolean {
    return scheduleOfflineFeed({
        userId,
        patch,
        previous,
        applyFriendPatch
    });
}

export {
    cancelRealtimeFriendPendingOffline,
    persistRealtimeFriendAdd,
    persistRealtimeFriendDelete,
    persistRealtimeFriendLocationFeed,
    persistRealtimeFriendOnlineFeed,
    persistRealtimeFriendUpdateFeed,
    scheduleRealtimeFriendOfflineFeed
};
