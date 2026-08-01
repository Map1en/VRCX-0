import { describe, expect, it } from 'vitest';

import {
    buildSameInstanceFriendGroups,
    resolveObservedPlayerDwellEpochs,
    resolveObservedPlayerUserId,
    resolveObservedPlayerUserIds,
    resolveSameInstanceFriendLocation
} from './sameInstanceFriends';

describe('sameInstanceFriends', () => {
    const currentLocation = 'wrld_current:123';
    const otherLocation = 'wrld_other:456';

    it('keeps the original two-friend threshold outside the current instance', () => {
        const first = {
            id: 'usr_1',
            state: 'online',
            location: otherLocation
        };
        const second = {
            id: 'usr_2',
            state: 'online',
            location: otherLocation
        };
        const solo = {
            id: 'usr_3',
            state: 'online',
            location: 'wrld_solo:789'
        };

        expect(
            buildSameInstanceFriendGroups([first, solo, second], {
                location: currentLocation
            })
        ).toEqual([
            {
                location: otherLocation,
                friends: [first, second],
                isCurrentInstance: false
            }
        ]);
    });

    it('keeps one friend when the current user is included in that instance', () => {
        const friend = {
            id: 'usr_friend',
            state: 'online',
            location: currentLocation
        };

        expect(
            buildSameInstanceFriendGroups(
                [friend],
                {
                    location: currentLocation
                },
                {
                    includeCurrentUser: true
                }
            )
        ).toEqual([
            {
                location: currentLocation,
                friends: [friend],
                isCurrentInstance: true
            }
        ]);
    });

    it('uses the observed current roster for an online friend with a hidden location', () => {
        const friend = {
            id: 'usr_hidden',
            state: 'online',
            location: 'private'
        };
        const lastLocation = {
            location: currentLocation,
            friendList: new Set(['usr_hidden'])
        };

        expect(resolveSameInstanceFriendLocation(friend, lastLocation)).toBe(
            currentLocation
        );
        expect(
            buildSameInstanceFriendGroups([friend], lastLocation, {
                includeCurrentUser: true
            })
        ).toEqual([
            {
                location: currentLocation,
                friends: [friend],
                isCurrentInstance: true
            }
        ]);
    });

    it('does not reveal a hidden friend who is absent from the observed roster', () => {
        expect(
            resolveSameInstanceFriendLocation(
                {
                    id: 'usr_hidden',
                    state: 'online',
                    location: 'private'
                },
                {
                    location: currentLocation,
                    friendList: new Set(['usr_other'])
                }
            )
        ).toBe('');
    });

    it('keeps an explicit instance instead of overriding it from the observed roster', () => {
        expect(
            resolveSameInstanceFriendLocation(
                {
                    id: 'usr_visible',
                    state: 'online',
                    location: otherLocation
                },
                {
                    location: currentLocation,
                    friendList: new Set(['usr_visible'])
                }
            )
        ).toBe(otherLocation);
    });

    it('does not promote an offline friend from the observed roster into the group', () => {
        const friend = {
            id: 'usr_offline',
            state: 'offline',
            location: 'private'
        };

        expect(
            buildSameInstanceFriendGroups([friend], {
                location: currentLocation,
                friendList: new Set(['usr_offline'])
            })
        ).toEqual([]);
    });

    it('prefers current top-level presence over a stale nested ref', () => {
        const friend = {
            id: 'usr_friend',
            state: 'online',
            location: currentLocation,
            ref: {
                id: 'usr_friend',
                state: 'offline',
                location: 'offline'
            }
        };

        expect(resolveSameInstanceFriendLocation(friend, null)).toBe(
            currentLocation
        );
    });

    it('requires two friends in the current instance when the current user is hidden', () => {
        const friend = {
            id: 'usr_friend',
            state: 'online',
            location: currentLocation
        };

        expect(
            buildSameInstanceFriendGroups([friend], {
                location: currentLocation
            })
        ).toEqual([]);
    });

    it('resolves a name-only observed player from the friend roster like original VRCX', () => {
        const friendsById = {
            usr_friend: {
                id: 'usr_friend',
                displayName: 'Exact Friend'
            }
        };

        expect(
            resolveObservedPlayerUserId(
                { userId: '', displayName: 'Exact Friend' },
                friendsById
            )
        ).toBe('usr_friend');
        expect(
            resolveObservedPlayerUserId(
                { userId: '', displayName: 'exact friend' },
                friendsById
            )
        ).toBe('');
        expect(
            resolveObservedPlayerUserIds(
                ['usr_known', 'display:Name Only'],
                [{ userId: '', displayName: 'Exact Friend' }],
                friendsById
            )
        ).toEqual(['usr_known', 'usr_friend']);
    });

    it('indexes persisted join times by the resolved friend id', () => {
        expect(
            resolveObservedPlayerDwellEpochs(
                [
                    {
                        userId: '',
                        displayName: 'Exact Friend',
                        joinedAtMs: 1_700_000_000_000
                    }
                ],
                {
                    usr_friend: {
                        id: 'usr_friend',
                        displayName: 'Exact Friend'
                    }
                }
            )
        ).toEqual(new Map([['usr_friend', 1_700_000_000_000]]));
    });
});
