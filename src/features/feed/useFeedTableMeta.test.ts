// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/useKnownUser', () => ({
    useKnownUserFacts: (userIds: unknown) =>
        Object.fromEntries(
            (Array.isArray(userIds) ? userIds : []).map((userId) => [
                userId,
                { id: userId }
            ])
        )
}));

import type { FeedFriendActions, FeedRow } from './feedTypes';
import { useFeedTableMeta } from './useFeedTableMeta';

function createActions(): FeedFriendActions {
    return {
        canSendInviteFromFeed: false,
        canBoopFromFeed: false,
        isFeedUserHidden: () => false,
        addFeedHiddenUser: async () => {},
        removeFeedHiddenUser: async () => {},
        canUseFeedFriendLocation: () => false,
        launchFeedFriendLocation: async () => {},
        selfInviteFeedFriendLocation: async () => {},
        sendFeedFriendInvite: async () => {},
        requestFeedFriendInvite: async () => {},
        sendFeedFriendBoop: async () => {},
        openFeedNewInstance: () => {}
    };
}

describe('useFeedTableMeta', () => {
    it('returns a stable reference exposing the latest field values', () => {
        const initialRows: FeedRow[] = [{ userId: 'usr_1' }];
        const initialProps = {
            actions: createActions(),
            friendLogNamesById: { usr_1: 'Alice' },
            loadingPreviousInstancesKey: '',
            onOpenPreviousInstances: () => {},
            rows: initialRows
        };
        const { result, rerender } = renderHook(
            (props) => useFeedTableMeta(props),
            { initialProps }
        );
        const initialMeta = result.current;

        expect(initialMeta.friendLogNamesById).toEqual({ usr_1: 'Alice' });
        expect(initialMeta.knownUsersById.usr_1).toBeDefined();

        const nextActions = createActions();
        const nextOnOpenPreviousInstances = () => {};
        rerender({
            actions: nextActions,
            friendLogNamesById: { usr_1: 'Bob' },
            loadingPreviousInstancesKey: 'wrld_1',
            onOpenPreviousInstances: nextOnOpenPreviousInstances,
            rows: [{ userId: 'usr_2' }]
        });

        expect(result.current).toBe(initialMeta);
        expect(initialMeta.actions).toBe(nextActions);
        expect(initialMeta.friendLogNamesById).toEqual({ usr_1: 'Bob' });
        expect(initialMeta.loadingPreviousInstancesKey).toBe('wrld_1');
        expect(initialMeta.onOpenPreviousInstances).toBe(
            nextOnOpenPreviousInstances
        );
        expect(initialMeta.knownUsersById.usr_2).toBeDefined();
        expect(initialMeta.knownUsersById.usr_1).toBeUndefined();
    });
});
