import { convertFileUrlToImageUrl } from '@/services/entityMediaService';

import { normalizeEntityId } from './groupInstances';

export function buildGroupDialogViewState({
    currentUserId,
    friendsById,
    group,
    ownerProfile
}: {
    currentUserId: string | null;
    friendsById: FriendRosterById;
    group: GroupProfileRecord;
    ownerProfile: UserProfileRecord | null;
}) {
    const bannerUrl = convertFileUrlToImageUrl(group.bannerUrl, 1024);
    const iconUrl = convertFileUrlToImageUrl(group.iconUrl, 256);
    const memberStatus = normalizeEntityId(
        group.myMember?.membershipStatus || group.membershipStatus
    ).toLowerCase();
    const isMember = memberStatus === 'member';
    const isBlocked = memberStatus === 'userblocked';
    const isRepresenting = Boolean(group.myMember?.isRepresenting);
    const isSubscribedToAnnouncements = Boolean(
        group.myMember?.isSubscribedToAnnouncements
    );
    const memberVisibility =
        normalizeEntityId(group.myMember?.visibility || 'visible') || 'visible';
    const joinState = normalizeEntityId(group.joinState).toLowerCase();
    const ownerDisplayName =
        normalizeEntityId(
            group.ownerDisplayName ||
                group.ownerName ||
                (typeof group.owner === 'object' && group.owner
                    ? Reflect.get(group.owner, 'displayName')
                    : '') ||
                ownerProfile?.displayName ||
                ownerProfile?.username ||
                ownerProfile?.name
        ) ||
        normalizeEntityId(friendsById[group.ownerId]?.displayName) ||
        normalizeEntityId(group.ownerId);
    const canJoin =
        !isMember &&
        memberStatus !== 'requested' &&
        memberStatus !== 'userblocked' &&
        (joinState === 'open' ||
            joinState === 'request' ||
            memberStatus === 'invited');

    return {
        bannerUrl,
        canJoin,
        currentUserId,
        iconUrl,
        isBlocked,
        isMember,
        isRepresenting,
        isSubscribedToAnnouncements,
        joinState,
        memberStatus,
        memberVisibility,
        ownerDisplayName
    };
}
import type {
    GroupProfileRecord,
    UserProfileRecord
} from '@/domain/entities/profileEntities';
import type { FriendRosterById } from '@/domain/friends/friendRosterTypes';
