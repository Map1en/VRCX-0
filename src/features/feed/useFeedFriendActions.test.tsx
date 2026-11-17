// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useFriendRosterStore } from '@/state/friendRosterStore';

import { useFeedFriendActions } from './useFeedFriendActions';

const friendsOnlyLocation = 'wrld_friends:12345~friends(usr_owner)';

describe('useFeedFriendActions', () => {
    afterEach(() => {
        useFriendRosterStore.getState().resetRoster();
    });

    it('keeps actions stable across friend presence changes and follows friend membership', () => {
        useFriendRosterStore.getState().setRosterSnapshot({
            currentUserId: 'usr_me',
            friendsById: {
                usr_other: { id: 'usr_other', displayName: 'Other' }
            }
        });
        const { result } = renderHook(() => useFeedFriendActions());
        const initialActions = result.current;
        expect(
            initialActions.canUseFeedFriendLocation(friendsOnlyLocation)
        ).toBe(false);

        const friendsByIdBeforePresence =
            useFriendRosterStore.getState().friendsById;
        act(() => {
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_other',
                presence: { rev: 1, view: { kind: 'active', platform: 'web' } }
            });
        });
        expect(useFriendRosterStore.getState().friendsById).not.toBe(
            friendsByIdBeforePresence
        );
        expect(result.current).toBe(initialActions);

        act(() => {
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_owner',
                patch: { id: 'usr_owner', displayName: 'Owner' }
            });
        });
        expect(result.current).not.toBe(initialActions);
        expect(
            result.current.canUseFeedFriendLocation(friendsOnlyLocation)
        ).toBe(true);
    });
});
