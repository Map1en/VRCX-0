import { describe, expect, it } from 'vitest';

import { getFriendsLocations, resolveFriendPresenceLocation } from './location.js';

describe('location utils', () => {
    it('uses current concrete location before traveling location for grouped friend locations', () => {
        expect(getFriendsLocations([
            {
                id: 'usr_a',
                location: 'wrld_current:12345',
                travelingToLocation: 'wrld_traveling:67890'
            }
        ])).toBe('wrld_current:12345');
    });

    it('falls back from current locations to traveling and then last known location', () => {
        expect(getFriendsLocations([
            {
                id: 'usr_a',
                location: 'traveling',
                travelingToLocation: 'wrld_traveling:67890'
            }
        ])).toBe('wrld_traveling:67890');

        expect(getFriendsLocations(
            [
                {
                    id: 'usr_a',
                    location: ''
                }
            ],
            {
                location: 'wrld_last:24680',
                friendList: new Set(['usr_a'])
            }
        )).toBe('wrld_last:24680');
    });

    it('resolves friend presence location from ref objects and respects sentinel locations', () => {
        expect(resolveFriendPresenceLocation({
            ref: {
                location: 'private',
                travelingToLocation: 'wrld_traveling:1'
            }
        })).toBe('private');

        expect(resolveFriendPresenceLocation(
            {
                ref: {
                    location: 'private'
                }
            },
            { requireInstance: true }
        )).toBe('');
    });

    it('prefers traveling location only when the friend is actually traveling', () => {
        const friend = {
            id: 'usr_a',
            location: 'wrld_current:12345',
            travelingToLocation: 'wrld_traveling:67890'
        };

        expect(resolveFriendPresenceLocation(friend)).toBe('wrld_traveling:67890');
        expect(resolveFriendPresenceLocation(friend, { preferTraveling: false })).toBe('wrld_current:12345');
    });

    it('can require concrete instance locations', () => {
        expect(resolveFriendPresenceLocation({
            location: 'wrld_only'
        }, {
            requireInstance: true
        })).toBe('');

        expect(resolveFriendPresenceLocation({
            location: 'wrld_123:instance1'
        }, {
            requireInstance: true
        })).toBe('wrld_123:instance1');
    });
});
