import { commands } from '@/platform/tauri/bindings';
import { signalFriendLogChanged } from '@/services/friendLogMutationService';
import { useRuntimeStore } from '@/state/runtimeStore';

type FriendLike = {
    id?: unknown;
    displayName?: unknown;
};
type DeleteFriendOptions = {
    currentUserId?: unknown;
    endpoint?: string;
    friend?: FriendLike | null;
    userId?: unknown;
};
type DeleteFriendResult = {
    stale: boolean;
    userId: string;
    localError?: string;
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
            ownerUserId: normalizeUserId(currentUserId),
            endpoint,
            targetUserId: normalizedUserId,
            targetDisplayName: normalizeUserId(friend?.displayName)
        });
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
        if (isStaleAuthScopeError(error)) {
            return {
                stale: true,
                userId: normalizedUserId
            };
        }
        throw error;
    }
}

const friendRelationshipService = Object.freeze({
    deleteFriend
});

export { deleteFriend };
export default friendRelationshipService;
