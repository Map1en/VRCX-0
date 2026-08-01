import { describe, expect, it } from 'vitest';

import { resolveUserDialogTargetPresenceLocation } from './userDialogContentHelpers';

describe('resolveUserDialogTargetPresenceLocation', () => {
    it('does not keep a stale instance for an explicitly offline friend', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: {
                    id: 'usr_target',
                    state: 'offline',
                    stateBucket: 'offline',
                    location: 'wrld_old:123'
                },
                targetUserId: 'usr_target',
                currentLocation: 'wrld_old:123',
                currentLocationPlayerIds: ['usr_target'],
                currentLocationPlayers: [],
                friendsById: {
                    usr_target: {
                        id: 'usr_target',
                        state: 'offline',
                        stateBucket: 'offline',
                        location: 'wrld_old:123'
                    }
                }
            })
        ).toBe('offline');
    });
    const currentLocation = 'wrld_current:123';

    it('uses the current instance for a private user observed in its player list', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: { id: 'usr_target', location: 'private' },
                targetUserId: 'usr_target',
                currentLocation,
                currentLocationPlayerIds: ['usr_self', 'usr_target']
            })
        ).toBe(currentLocation);
    });

    it('uses the current instance for an offline non-friend observed in its player list', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: { id: 'usr_target', location: 'offline' },
                targetUserId: 'usr_target',
                currentLocation,
                currentLocationPlayerIds: ['usr_target']
            })
        ).toBe(currentLocation);
    });

    it('keeps a hidden location when the user is not in the current player list', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
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
            resolveUserDialogTargetPresenceLocation({
                profile: hiddenFriend,
                targetUserId: hiddenFriend.id,
                currentLocation,
                currentLocationPlayerIds: ['usr_self', hiddenFriend.id]
            })
        ).toBe(currentLocation);
    });

    it('promotes a name-only GameLog player after resolving it from the friend roster', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: {
                    id: 'usr_friend',
                    displayName: 'Hidden Friend',
                    location: 'private'
                },
                targetUserId: 'usr_friend',
                currentLocation,
                currentLocationPlayerIds: [],
                currentLocationPlayers: [
                    { userId: '', displayName: 'Hidden Friend' }
                ],
                friendsById: {
                    usr_friend: {
                        id: 'usr_friend',
                        displayName: 'Hidden Friend'
                    }
                }
            })
        ).toBe(currentLocation);
    });

    it('keeps a visible presence location instead of overriding it', () => {
        const visibleLocation = 'wrld_visible:456';

        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: { id: 'usr_target', location: visibleLocation },
                targetUserId: 'usr_target',
                currentLocation,
                currentLocationPlayerIds: ['usr_target']
            })
        ).toBe(visibleLocation);
    });

    it('does not expose a location after the current instance stops being concrete', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: { id: 'usr_target', location: 'private' },
                targetUserId: 'usr_target',
                currentLocation: 'traveling',
                currentLocationPlayerIds: ['usr_target']
            })
        ).toBe('private');
    });
});
