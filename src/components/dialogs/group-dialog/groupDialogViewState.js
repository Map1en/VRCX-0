import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';

import { normalizeEntityId } from './groupInstances.js';

export function buildGroupDialogViewState({
    currentUserId,
    friendsById,
    group,
    ownerProfile
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
                group.owner?.displayName ||
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
