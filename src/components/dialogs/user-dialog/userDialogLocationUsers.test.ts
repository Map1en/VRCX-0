import { describe, expect, it } from 'vitest';

import {
    buildUserDialogLocationUsers,
    shouldIncludeUserDialogLocationFriend
} from './userDialogLocationUsers';

describe('buildUserDialogLocationUsers', () => {
    const t = (key: string) => key;
    const parsedLocation = {
        isRealInstance: true,
        userId: 'usr_owner',
        groupId: ''
    };

    it('shows only the current user and friends in an instance roster', () => {
        const result = buildUserDialogLocationUsers({
            currentUserId: 'usr_self',
            friendsById: {
                usr_friend: { id: 'usr_friend' }
            },
            locationInstance: {},
            locationOwnerGroup: null,
            locationOwnerUser: {
                id: 'usr_owner',
                displayName: 'Non-friend owner'
            },
            profile: {
                id: 'usr_target',
                displayName: 'Non-friend target'
            },
            sameInstanceUsers: [
                { id: 'usr_self', displayName: 'Self' },
                { id: 'usr_friend', displayName: 'Friend' },
                { id: 'usr_target', displayName: 'Non-friend target' },
                { id: 'usr_other', displayName: 'Other non-friend' }
            ],
            t,
            visiblePresenceParsedLocation: parsedLocation
        });

        expect(result.locationInstanceUsers.map((user) => user.id)).toEqual([
            'usr_self',
            'usr_friend'
        ]);
        expect(result.locationOwnerId).toBe('usr_owner');
    });

    it('does not add a non-friend profile as the roster fallback', () => {
        const result = buildUserDialogLocationUsers({
            currentUserId: 'usr_self',
            friendsById: {},
            locationInstance: {},
            locationOwnerGroup: null,
            locationOwnerUser: null,
            profile: {
                id: 'usr_target',
                displayName: 'Non-friend target'
            },
            sameInstanceUsers: [],
            t,
            visiblePresenceParsedLocation: parsedLocation
        });

        expect(result.locationInstanceUsers).toEqual([]);
    });

    it('restores name-only Busy and Ask Me friends from the observed roster', () => {
        const result = buildUserDialogLocationUsers({
            currentUserId: 'usr_self',
            friendsById: {
                usr_busy: {
                    id: 'usr_busy',
                    displayName: 'Busy Friend',
                    status: 'busy',
                    location: 'private'
                },
                usr_ask: {
                    id: 'usr_ask',
                    displayName: 'Ask Friend',
                    status: 'ask me',
                    location: 'private'
                }
            },
            locationInstance: {},
            locationOwnerGroup: null,
            locationOwnerUser: null,
            profile: null,
            sameInstanceUsers: [
                { userId: '', displayName: 'Busy Friend' },
                { userId: '', displayName: 'Ask Friend' }
            ],
            t,
            visiblePresenceParsedLocation: parsedLocation
        });

        expect(result.locationInstanceUsers.map((user) => user.id)).toEqual([
            'usr_busy',
            'usr_ask'
        ]);
    });

    it('keeps the original private inactive friend guard outside the observed current roster', () => {
        const friend = {
            id: 'usr_friend',
            state: 'active',
            location: 'private'
        };

        expect(
            shouldIncludeUserDialogLocationFriend({
                currentLocationMatches: false,
                currentLocationPlayerIds: new Set(['usr_friend']),
                friend
            })
        ).toBe(false);
        expect(
            shouldIncludeUserDialogLocationFriend({
                currentLocationMatches: true,
                currentLocationPlayerIds: new Set(['usr_friend']),
                friend
            })
        ).toBe(true);
    });

    it.each(['busy', 'ask me'])(
        'keeps an observed %s friend despite a private remote presence',
        (status) => {
            const friend = {
                id: 'usr_friend',
                state: 'active',
                status,
                location: 'private'
            };

            expect(
                shouldIncludeUserDialogLocationFriend({
                    currentLocationMatches: true,
                    currentLocationPlayerIds: new Set(['usr_friend']),
                    friend
                })
            ).toBe(true);
        }
    );
});
