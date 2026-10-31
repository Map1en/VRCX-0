import { describe, expect, it } from 'vitest';

import { deriveUserRelationshipBadges } from './userRelationshipBadges';

describe('deriveUserRelationshipBadges', () => {
    it('lists every active relationship and moderation state in order', () => {
        expect(
            deriveUserRelationshipBadges({
                isFriend: true,
                friendRequestState: { incoming: true, outgoing: true },
                moderationState: { block: true, mute: true },
                avatarOverrideState: { hideAvatar: true },
                extendedModerationState: { interactOff: true, muteChat: true }
            })
        ).toEqual([
            'friend',
            'blocked',
            'muted',
            'avatar-hidden',
            'interaction-off',
            'chatbox-muted'
        ]);
    });

    it('prefers an incoming request over an outgoing one for non-friends', () => {
        expect(
            deriveUserRelationshipBadges({
                friendRequestState: { incoming: true, outgoing: true }
            })
        ).toEqual(['request-received']);
        expect(
            deriveUserRelationshipBadges({
                friendRequestState: { outgoing: true }
            })
        ).toEqual(['request-sent']);
    });

    it('returns nothing for a stranger without moderation', () => {
        expect(deriveUserRelationshipBadges({})).toEqual([]);
    });
});
