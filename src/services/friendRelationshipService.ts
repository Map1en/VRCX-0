import vrchatFriendRepository from '@/repositories/vrchatFriendRepository';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

type FriendLike = {
    id?: unknown;
};
type AuthTarget = {
    currentUserId?: unknown;
    endpoint?: string;
};
type DeleteFriendOptions = AuthTarget & {
    friend?: FriendLike | null;
    userId?: unknown;
};
type DeleteFriendResult = {
    stale: boolean;
    userId: string;
};

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isCurrentAuthTarget({ currentUserId, endpoint }: AuthTarget): boolean {
    const auth = useRuntimeStore.getState().auth;
    return (
        auth.currentUserId === currentUserId &&
        auth.currentUserEndpoint === endpoint
    );
}

function removeFromArray(values: unknown, userId: string): string[] {
    return Array.isArray(values)
        ? values.filter((value) => normalizeUserId(value) !== userId)
        : [];
}

function applyLocalFriendDelete(userId: string): void {
    useFriendRosterStore.getState().removeFriend(userId);
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
    useShellStore.getState().notifyMenu('friend-log');
}

async function refreshRustFriendSnapshotAfterLocalMutation() {
    try {
        const { refreshFriendAndFavoriteSnapshots } =
            await import('./backgroundMaintenanceService');
        await refreshFriendAndFavoriteSnapshots({ syncRealtime: false });
    } catch (error) {
        console.warn('Realtime friend snapshot refresh failed:', error);
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

    await vrchatFriendRepository.deleteFriend({
        userId: normalizedUserId,
        endpoint
    });

    if (!isCurrentAuthTarget({ currentUserId, endpoint })) {
        return {
            stale: true,
            userId: normalizedUserId
        };
    }

    const { recordFriendLogUnfriendByUserId } =
        await import('./friendBootstrapService');
    await recordFriendLogUnfriendByUserId({
        currentUserId,
        targetUserId: normalizedUserId
    });
    applyLocalFriendDelete(normalizedUserId);
    await refreshRustFriendSnapshotAfterLocalMutation();

    return {
        stale: false,
        userId: normalizedUserId
    };
}

const friendRelationshipService = Object.freeze({
    deleteFriend
});

export { deleteFriend };
export default friendRelationshipService;
