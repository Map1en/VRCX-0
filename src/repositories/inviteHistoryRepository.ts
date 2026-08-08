import {
    commands,
    type FriendInviteCountsRow
} from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';

export type { FriendInviteCountsRow };

async function getFriendInviteCounts(
    ownerUserId: unknown,
    userIds: readonly unknown[]
): Promise<FriendInviteCountsRow[]> {
    const normalizedOwnerUserId = normalizeString(ownerUserId);
    const normalizedUserIds = Array.from(
        new Set(userIds.map(normalizeString).filter(Boolean))
    );
    if (!normalizedOwnerUserId || !normalizedUserIds.length) {
        return [];
    }
    return commands.appFriendInviteCountsQuery({
        ownerUserId: normalizedOwnerUserId,
        userIds: normalizedUserIds
    });
}

export default { getFriendInviteCounts };
