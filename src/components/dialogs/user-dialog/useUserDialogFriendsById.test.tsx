// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useFriendRosterStore } from '@/state/friendRosterStore';
import { onlinePresence } from '@/test/presenceFixtures';

import {
    useUserDialogLocationFriendsById,
    useUserDialogTargetFriendsById
} from './useUserDialogFriendsById';

const instance = 'wrld_target:12345';
let presenceRev = 0;

function moveFriend(userId: string, location: string) {
    presenceRev += 1;
    act(() => {
        useFriendRosterStore.getState().applyFriendPatch({
            userId,
            presence: { rev: presenceRev, view: onlinePresence(location) }
        });
    });
}

function patchFriend(userId: string, statusDescription: string) {
    act(() => {
        useFriendRosterStore.getState().applyFriendPatch({
            userId,
            patch: { statusDescription }
        });
    });
}

function liveFriend(userId: string) {
    return useFriendRosterStore.getState().friendsById[userId];
}

function renderDialogFriends() {
    return renderHook(
        ({ snapshotKey }: { snapshotKey: string }) => {
            const targetFriend = useFriendRosterStore(
                (state) => state.friendsById.usr_target ?? null
            );
            const targetFriendsById = useUserDialogTargetFriendsById({
                normalizedUserId: 'usr_target',
                snapshotKey,
                targetFriend
            });
            return useUserDialogLocationFriendsById(
                targetFriendsById,
                instance
            );
        },
        { initialProps: { snapshotKey: 'open-1' } }
    );
}

describe('user dialog friend directory', () => {
    beforeEach(() => {
        useFriendRosterStore.getState().setRosterSnapshot({
            currentUserId: 'usr_me',
            friendsById: {
                usr_target: { id: 'usr_target', displayName: 'Target' },
                usr_near: { id: 'usr_near', displayName: 'Near' },
                usr_far: { id: 'usr_far', displayName: 'Far' }
            }
        });
        moveFriend('usr_target', instance);
        moveFriend('usr_near', instance);
        moveFriend('usr_far', 'wrld_other:1');
    });

    afterEach(() => {
        useFriendRosterStore.getState().resetRoster();
    });

    it('ignores friends outside the target instance until the dialog reloads', () => {
        const { result, rerender } = renderDialogFriends();
        const initial = result.current;

        moveFriend('usr_far', 'wrld_elsewhere:2');
        patchFriend('usr_far', 'away');

        expect(result.current).toBe(initial);
        expect(result.current.usr_far).not.toBe(liveFriend('usr_far'));

        rerender({ snapshotKey: 'open-2' });

        expect(result.current.usr_far).toBe(liveFriend('usr_far'));
    });

    it('retakes the snapshot once a roster that was still loading becomes ready', () => {
        act(() => {
            useFriendRosterStore.getState().setRosterLoading('usr_me');
        });
        const { result } = renderDialogFriends();
        moveFriend('usr_far', 'wrld_elsewhere:2');
        expect(result.current.usr_far).not.toBe(liveFriend('usr_far'));

        act(() => {
            useFriendRosterStore.getState().setRosterReady();
        });

        expect(result.current.usr_far).toBe(liveFriend('usr_far'));
    });

    it('follows the target and friends entering, changing in or leaving the target instance', () => {
        const { result } = renderDialogFriends();

        patchFriend('usr_target', 'busy');
        expect(result.current.usr_target).toBe(liveFriend('usr_target'));

        patchFriend('usr_near', 'chatting');
        expect(result.current.usr_near).toBe(liveFriend('usr_near'));

        moveFriend('usr_far', instance);
        expect(result.current.usr_far).toBe(liveFriend('usr_far'));

        moveFriend('usr_near', 'wrld_other:1');
        expect(result.current.usr_near).toBe(liveFriend('usr_near'));
    });
});
