import {
    commands,
    type SocialUnfriendBatchItemResult,
    type SocialUnfriendBatchResult
} from '@/platform/tauri/bindings';
import { signalFriendLogChanged } from '@/services/friendLogMutationService';
import { useRuntimeStore } from '@/state/runtimeStore';

type FriendLike = {
    id?: string;
    displayName?: string;
};
type DeleteFriendOptions = {
    currentUserId?: string | null;
    endpoint?: string;
    friend?: FriendLike | null;
    userId?: string | null;
};
type DeleteFriendResult = {
    stale: boolean;
    userId: string;
    localError?: string;
};
type DeleteFriendsOptions = {
    expectedEndpoint: string;
    expectedOwnerUserId: string;
    friends?: FriendLike[];
};
type DeleteFriendsResult = SocialUnfriendBatchResult & {
    stale: boolean;
};

const STALE_AUTH_SCOPE_ERROR_TEXT = 'stale for the current auth scope';

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isStaleAuthScopeError(error: unknown): boolean {
    return (
        error instanceof Error &&
        error.message.includes(STALE_AUTH_SCOPE_ERROR_TEXT)
    );
}

function currentAuthScopeMatches(ownerUserId: string, endpoint: string) {
    const auth = useRuntimeStore.getState().auth;
    return (
        normalizeUserId(auth.currentUserId) === normalizeUserId(ownerUserId) &&
        normalizeUserId(auth.currentUserEndpoint) === normalizeUserId(endpoint)
    );
}

function removeFromArray(values: unknown, userId: string): string[] {
    return Array.isArray(values)
        ? values.filter((value) => normalizeUserId(value) !== userId)
        : [];
}

function patchCurrentUserSnapshotFriendArrays(userId: string): void {
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = runtimeStore.auth.currentUserSnapshot;
    if (snapshot && typeof snapshot === 'object') {
        runtimeStore.setAuthBootstrap({
            currentUserSnapshot: {
                ...snapshot,
                friends: removeFromArray(snapshot.friends, userId),
                onlineFriends: removeFromArray(snapshot.onlineFriends, userId),
                activeFriends: removeFromArray(snapshot.activeFriends, userId),
                offlineFriends: removeFromArray(snapshot.offlineFriends, userId)
            }
        });
    }
}

async function deleteFriend({
    friend,
    userId,
    endpoint = '',
    currentUserId = ''
}: DeleteFriendOptions = {}): Promise<DeleteFriendResult> {
    const normalizedUserId = normalizeUserId(userId || friend?.id);
    if (!normalizedUserId) {
        throw new Error('deleteFriend requires a friend user id.');
    }

    try {
        const outcome = await commands.appSocialUnfriend({
            targetUserId: normalizedUserId,
            targetDisplayName: normalizeUserId(friend?.displayName)
        });
        if (
            !currentAuthScopeMatches(normalizeUserId(currentUserId), endpoint)
        ) {
            return {
                stale: true,
                userId: normalizedUserId
            };
        }
        patchCurrentUserSnapshotFriendArrays(normalizedUserId);
        signalFriendLogChanged();

        return {
            stale: false,
            userId: normalizedUserId,
            localError:
                outcome.status === 'remoteOkLocalFailed'
                    ? (outcome.localError ?? undefined)
                    : undefined
        };
    } catch (error) {
        if (
            isStaleAuthScopeError(error) ||
            !currentAuthScopeMatches(normalizeUserId(currentUserId), endpoint)
        ) {
            return {
                stale: true,
                userId: normalizedUserId
            };
        }
        throw error;
    }
}

async function deleteFriends({
    expectedEndpoint,
    expectedOwnerUserId,
    friends = []
}: DeleteFriendsOptions): Promise<DeleteFriendsResult> {
    const targets = Array.from(
        new Map(
            friends
                .map((friend) => {
                    const userId = normalizeUserId(friend?.id);
                    return [
                        userId,
                        {
                            userId,
                            displayName: normalizeUserId(friend?.displayName)
                        }
                    ] as const;
                })
                .filter(([userId]) => Boolean(userId))
        ).values()
    );
    if (!targets.length) {
        throw new Error('deleteFriends requires at least one friend user id.');
    }
    const outcome = await commands.appSocialUnfriendSelection({
        targets
    });
    const stale =
        outcome.scopeChanged ||
        !currentAuthScopeMatches(expectedOwnerUserId, expectedEndpoint);
    const appliedItems = stale
        ? []
        : outcome.items.filter(isRemoteUnfriendApplied);
    if (appliedItems.length) {
        for (const item of appliedItems) {
            patchCurrentUserSnapshotFriendArrays(item.userId);
        }
        signalFriendLogChanged();
    }
    return {
        ...outcome,
        stale
    };
}

function isRemoteUnfriendApplied(item: SocialUnfriendBatchItemResult): boolean {
    return item.state === 'applied' || item.state === 'remoteOkLocalFailed';
}

const friendRelationshipService = Object.freeze({
    deleteFriend,
    deleteFriends
});

export { deleteFriend, deleteFriends };
export default friendRelationshipService;
