import { describe, expect, it } from 'vitest';

import { resolveEffectivePresenceLocation } from './userDialogContentHelpers';

describe('resolveEffectivePresenceLocation', () => {
    const currentLocation = 'wrld_current:123';

    it('uses the current instance for a private user observed in its player list', () => {
        expect(
            resolveEffectivePresenceLocation({
                profile: { id: 'usr_target', location: 'private' },
                targetUserId: 'usr_target',
                currentLocation,
                currentLocationPlayerIds: ['usr_self', 'usr_target']
            })
        ).toBe(currentLocation);
    });

    it('uses the current instance for an offline non-friend observed in its player list', () => {
        expect(
            resolveEffectivePresenceLocation({
                profile: { id: 'usr_target', location: 'offline' },
                targetUserId: 'usr_target',
                currentLocation,
                currentLocationPlayerIds: ['usr_target']
            })
        ).toBe(currentLocation);
    });

    it('keeps a hidden location when the user is not in the current player list', () => {
        expect(
            resolveEffectivePresenceLocation({
                profile: { id: 'usr_target', location: 'private' },
                targetUserId: 'usr_target',
                currentLocation,
                currentLocationPlayerIds: ['usr_other']
            })
        ).toBe('private');
    });

    it('promotes a hidden friend location when resolving that friend from the current player list', () => {
        const hiddenFriend = {
            id: 'usr_friend',
            location: 'private',
            isFriend: true
        };

        expect(
            resolveEffectivePresenceLocation({
                profile: hiddenFriend,
                targetUserId: hiddenFriend.id,
                currentLocation,
                currentLocationPlayerIds: ['usr_self', hiddenFriend.id]
            })
        ).toBe(currentLocation);
    });

    it('keeps a visible presence location instead of overriding it', () => {
        const visibleLocation = 'wrld_visible:456';

        expect(
            resolveEffectivePresenceLocation({
                profile: { id: 'usr_target', location: visibleLocation },
                targetUserId: 'usr_target',
                currentLocation,
                currentLocationPlayerIds: ['usr_target']
            })
        ).toBe(visibleLocation);
    });

    it('does not expose a location after the current instance stops being concrete', () => {
        expect(
            resolveEffectivePresenceLocation({
                profile: { id: 'usr_target', location: 'private' },
                targetUserId: 'usr_target',
                currentLocation: 'traveling',
                currentLocationPlayerIds: ['usr_target']
            })
        ).toBe('private');
    });
});
