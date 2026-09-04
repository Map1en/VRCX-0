import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useUserFactsStore } from '@/state/userFactsStore';

import {
    flushRealtimeRosterUpdates,
    queueRealtimeFriendRosterUpdate,
    queueRealtimeUserFactsUpdate,
    resetRealtimeRosterUpdates
} from './realtimeRosterUpdateQueue';

function seedRoster(currentUserId: string) {
    useFriendRosterStore.getState().setRosterSnapshot({
        currentUserId,
        friendsById: {
            usr_friend: {
                id: 'usr_friend',
                displayName: 'Friend',
                state: 'online'
            }
        },
        orderedFriendIds: ['usr_friend'],
        onlineIds: ['usr_friend'],
        activeIds: [],
        offlineIds: []
    });
}

function friendPatch(displayName: string) {
    return [
        {
            userId: 'usr_friend',
            patch: { id: 'usr_friend', displayName },
            stateBucketAuthority: 'preserve' as const
        }
    ];
}

describe('realtimeRosterUpdateQueue', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useFriendRosterStore.getState().resetRoster();
        useFriendLocationTimeStore.getState().reset();
        useUserFactsStore.getState().resetUserFacts();
        resetRealtimeRosterUpdates();
        seedRoster('usr_self');
    });

    afterEach(() => {
        resetRealtimeRosterUpdates();
        vi.useRealTimers();
    });

    it('applies the first update immediately and coalesces the burst that follows', () => {
        queueRealtimeFriendRosterUpdate(friendPatch('First'), false);
        expect(
            useFriendRosterStore.getState().friendsById.usr_friend.displayName
        ).toBe('First');

        queueRealtimeFriendRosterUpdate(friendPatch('Second'), false);
        queueRealtimeUserFactsUpdate([
            {
                id: 'usr_friend',
                endpoint: 'https://api.example.test',
                displayName: 'Second'
            }
        ]);
        queueRealtimeFriendRosterUpdate(friendPatch('Third'), false);
        expect(
            useFriendRosterStore.getState().friendsById.usr_friend.displayName
        ).toBe('First');

        vi.advanceTimersByTime(500);
        expect(
            useFriendRosterStore.getState().friendsById.usr_friend.displayName
        ).toBe('Third');
        expect(
            useUserFactsStore.getState().usersByKey[
                'https://api.example.test::usr_friend'
            ]
        ).toMatchObject({ displayName: 'Second' });
    });

    it('drops buffered updates when the roster owner changed', () => {
        queueRealtimeFriendRosterUpdate(friendPatch('First'), false);
        queueRealtimeFriendRosterUpdate(friendPatch('Buffered'), false);

        seedRoster('usr_other');
        flushRealtimeRosterUpdates();

        expect(
            useFriendRosterStore.getState().friendsById.usr_friend.displayName
        ).toBe('Friend');
    });

    it('atomically applies the latest complete location-time snapshot with its patches', () => {
        queueRealtimeFriendRosterUpdate(friendPatch('First'), false, [
            {
                userId: 'usr_friend',
                location: 'wrld_first:1',
                source: 'realtime',
                sinceMs: 1_700_000_000_000
            },
            {
                userId: 'usr_removed',
                location: 'wrld_removed:1',
                source: 'realtime',
                sinceMs: 1_700_000_000_000
            }
        ]);
        queueRealtimeFriendRosterUpdate(friendPatch('Second'), false, [
            {
                userId: 'usr_friend',
                location: 'wrld_second:2',
                source: 'realtime',
                sinceMs: 1_700_000_100_000
            }
        ]);

        flushRealtimeRosterUpdates();

        expect(
            useFriendRosterStore.getState().friendsById.usr_friend.displayName
        ).toBe('Second');
        expect(useFriendLocationTimeStore.getState().byUserId).toEqual({
            usr_friend: {
                location: 'wrld_second:2',
                source: 'realtime',
                sinceMs: 1_700_000_100_000
            }
        });
    });

    it('applies an empty snapshot as an explicit clear', () => {
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: 'usr_friend',
                location: 'wrld_old:1',
                source: 'realtime',
                sinceMs: 1_700_000_000_000
            }
        ]);

        queueRealtimeFriendRosterUpdate([], false, []);

        expect(useFriendLocationTimeStore.getState().byUserId).toEqual({});
    });
});
