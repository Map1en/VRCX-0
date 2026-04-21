import {
    friendLogHistoryRepository,
    friendLogRepository
} from '@/repositories/index.js';
import vrchatFriendRepository from '@/repositories/vrchatFriendRepository.js';
import { handleRealtimePresenceEvent } from '@/services/realtimePresenceService.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

function normalizeUserId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isCurrentAuthTarget({ currentUserId, endpoint }) {
    const auth = useRuntimeStore.getState().auth;
    return (
        auth.currentUserId === currentUserId &&
        auth.currentUserEndpoint === endpoint
    );
}

async function deleteFriend({
    friend,
    userId,
    endpoint = '',
    currentUserId = ''
}) {
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

    const entry = {
        created_at: new Date().toJSON(),
        type: 'Unfriend',
        userId: normalizedUserId,
        displayName: friend?.displayName || normalizedUserId,
        friendNumber: friend?.$friendNumber ?? friend?.friendNumber ?? null
    };

    await Promise.all([
        friendLogHistoryRepository.addFriendLogHistory(currentUserId, entry),
        friendLogRepository.deleteFriendLogCurrent(
            currentUserId,
            normalizedUserId
        )
    ]);
    handleRealtimePresenceEvent({
        type: 'friend-delete',
        content: {
            userId: normalizedUserId
        }
    });

    return {
        stale: false,
        userId: normalizedUserId,
        entry
    };
}

const friendRelationshipService = {
    deleteFriend
};

export { deleteFriend };
export default friendRelationshipService;
