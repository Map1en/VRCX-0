import { describe, expect, it } from 'vitest';

import { resolveFriendRowLocationState } from './FriendsSidebarLocation';

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
});
