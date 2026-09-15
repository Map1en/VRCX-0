import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { normalizeString } from '@/shared/utils/string';

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
    const memberStatus = normalizeString(
        group.myMember?.membershipStatus || group.membershipStatus
    ).toLowerCase();
    const isMember = memberStatus === 'member';
    const isBlocked = memberStatus === 'userblocked';
    const isRepresenting = Boolean(group.myMember?.isRepresenting);
    const isSubscribedToAnnouncements = Boolean(
        group.myMember?.isSubscribedToAnnouncements
    );
    const memberVisibility =
        normalizeString(group.myMember?.visibility || 'visible') || 'visible';
    const joinState = normalizeString(group.joinState).toLowerCase();
    const ownerDisplayName =
        normalizeString(
            group.ownerDisplayName ||
                group.ownerName ||
                (typeof group.owner === 'object' && group.owner
                    ? Reflect.get(group.owner, 'displayName')
                    : '') ||
                ownerProfile?.displayName ||
                ownerProfile?.username ||
                ownerProfile?.name
        ) ||
        normalizeString(friendsById[group.ownerId]?.displayName) ||
        normalizeString(group.ownerId);
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
import type { GroupProfileRecord } from '@/domain/entities/group';
import type { UserProfileRecord } from '@/domain/entities/user';
import type { FriendRosterById } from '@/domain/friends/types';
