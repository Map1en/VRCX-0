import { describe, expect, it } from 'vitest';

import {
    buildSidebarLocationMetadataEntry,
    resolveFriendRowLocationState
} from './FriendsSidebarLocation';

describe('resolveFriendRowLocationState', () => {
    it('keeps local room timing visible without a remote traveling indicator', () => {
        for (const remote of [
            { state: 'offline', location: 'offline' },
            {
                state: 'online',
                location: 'traveling',
                travelingToLocation: 'wrld_other:2'
            }
        ]) {
            const state = resolveFriendRowLocationState({
                friend: { id: 'usr_friend', ...remote },
                isGroupByInstance: true,
                locationTime: {
                    location: 'wrld_local:1',
                    sinceMs: 1_000,
                    source: 'gameLog'
                }
            });
            expect(state.friendLocation).toBe('wrld_local:1');
            expect(state.isTraveling).toBe(false);
            expect(state.groupByInstanceTimerVisible).toBe(true);
        }
    });

    it('keeps the same-instance timer visible while offline is pending', () => {
        const state = resolveFriendRowLocationState({
            friend: {
                id: 'usr_friend',
                state: 'online',
                location: 'private',
                pendingOffline: true
            },
            isGroupByInstance: true
        });

        expect(state.groupByInstanceTimerVisible).toBe(true);
        expect(state.showLocationSubline).toBe(false);
    });

    it('hides the same-instance timer after offline is confirmed', () => {
        const state = resolveFriendRowLocationState({
            friend: {
                id: 'usr_friend',
                state: 'offline',
                location: 'private'
            },
            isGroupByInstance: true
        });

        expect(state.groupByInstanceTimerVisible).toBe(false);
    });

    it('uses the backend-projected room when a busy friend API location is private', () => {
        const friend = {
            id: 'usr_busy',
            state: 'online',
            status: 'busy',
            location: 'private'
        };
        const locationTime = {
            location: 'wrld_current:123',
            source: 'realtime' as const,
            sinceMs: 1_700_000_000_000
        };
        const state = resolveFriendRowLocationState({
            friend,
            locationTime
        });

        expect(state.friendLocation).toBe('wrld_current:123');
        expect(state.displayLocation).toBe('wrld_current:123');
        expect(state.parsedFriendLocation.isRealInstance).toBe(true);
        expect(state.showLocationSubline).toBe(true);
        expect(
            buildSidebarLocationMetadataEntry(
                {
                    type: 'friend',
                    key: 'friend:favorites:usr_busy',
                    friend
                },
                { usr_busy: locationTime }
            )
        ).toMatchObject({
            currentLocation: 'wrld_current:123'
        });
    });

    it('keeps a private location without a projected real instance', () => {
        const state = resolveFriendRowLocationState({
            friend: {
                id: 'usr_busy',
                state: 'online',
                status: 'busy',
                location: 'private'
            },
            locationTime: {
                location: 'private',
                source: 'realtime',
                sinceMs: null
            }
        });

        expect(state.friendLocation).toBe('private');
        expect(state.displayLocation).toBe('private');
        expect(state.parsedFriendLocation.isPrivate).toBe(true);
    });

    it('keeps an explicit API instance instead of a conflicting projection', () => {
        const state = resolveFriendRowLocationState({
            friend: {
                id: 'usr_remote',
                state: 'online',
                location: 'wrld_remote:456'
            },
            locationTime: {
                location: 'wrld_current:123',
                source: 'realtime',
                sinceMs: 1_700_000_000_000
            }
        });

        expect(state.friendLocation).toBe('wrld_remote:456');
        expect(state.displayLocation).toBe('wrld_remote:456');
    });

    it('keeps traveling semantics when the projection contains the destination', () => {
        const state = resolveFriendRowLocationState({
            friend: {
                id: 'usr_traveling',
                state: 'online',
                location: 'traveling',
                travelingToLocation: 'wrld_destination:789'
            },
            locationTime: {
                location: 'wrld_destination:789',
                source: 'realtime',
                sinceMs: 1_700_000_000_000
            }
        });

        expect(state.friendLocation).toBe('traveling');
        expect(state.displayLocation).toBe('traveling');
        expect(state.displayTraveling).toBe('wrld_destination:789');
        expect(state.isTraveling).toBe(true);
    });
});
