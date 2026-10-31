export type UserRelationshipBadgeKey =
    | 'friend'
    | 'request-sent'
    | 'request-received'
    | 'blocked'
    | 'muted'
    | 'avatar-hidden'
    | 'interaction-off'
    | 'chatbox-muted';

export type UserRelationshipBadgeInput = {
    isFriend?: boolean;
    friendRequestState?: { incoming?: boolean; outgoing?: boolean };
    moderationState?: { block?: boolean; mute?: boolean };
    avatarOverrideState?: { hideAvatar?: boolean };
    extendedModerationState?: { interactOff?: boolean; muteChat?: boolean };
};

export function deriveUserRelationshipBadges({
    isFriend = false,
    friendRequestState,
    moderationState,
    avatarOverrideState,
    extendedModerationState
}: UserRelationshipBadgeInput): UserRelationshipBadgeKey[] {
    const badges: UserRelationshipBadgeKey[] = [];
    if (isFriend) {
        badges.push('friend');
    } else if (friendRequestState?.incoming) {
        badges.push('request-received');
    } else if (friendRequestState?.outgoing) {
        badges.push('request-sent');
    }
    if (moderationState?.block) {
        badges.push('blocked');
    }
    if (moderationState?.mute) {
        badges.push('muted');
    }
    if (avatarOverrideState?.hideAvatar) {
        badges.push('avatar-hidden');
    }
    if (extendedModerationState?.interactOff) {
        badges.push('interaction-off');
    }
    if (extendedModerationState?.muteChat) {
        badges.push('chatbox-muted');
    }
    return badges;
}
