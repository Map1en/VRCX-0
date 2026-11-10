// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FavoriteKind } from '@/domain/favorites/types';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { useFavoritesCollectionsState } from './useFavoritesCollectionsState';

const mocks = vi.hoisted(() => ({
    localWorlds: { groupNames: [], favoritesByGroup: {}, reload: vi.fn() },
    details: { data: {}, availabilityById: {}, status: 'ready' },
    avatarFallbacks: {},
    getAvatarHistory: vi.fn()
}));

vi.mock('@/components/favorites/useLocalWorldFavorites', () => ({
    useLocalWorldFavorites: () => mocks.localWorlds
}));
vi.mock('./useFavoriteRemoteDetails', () => ({
    useFavoriteRemoteDetails: () => mocks.details
}));
vi.mock('./useAvatarDetailFallbacks', () => ({
    useAvatarDetailFallbacks: () => mocks.avatarFallbacks
}));
vi.mock('@/repositories/avatarLocalRepository', () => ({
    default: { getAvatarHistory: mocks.getAvatarHistory }
}));

const visibleWorldIds: string[] = [];

function renderCollections(kind: FavoriteKind) {
    return renderHook(() =>
        useFavoritesCollectionsState({
            currentEndpoint: 'https://example.test',
            currentUserId: 'usr_self',
            kind,
            loadAllRemoteDetails: false,
            selectedGroupKey: '',
            selectedSource: 'remote',
            visibleWorldIds
        })
    );
}

beforeEach(() => {
    mocks.getAvatarHistory.mockReset().mockResolvedValue([]);
    useFriendRosterStore.getState().resetRoster();
    useFriendRosterStore.getState().applyFriendPatch({
        userId: 'usr_friend',
        patch: { displayName: 'Friend' }
    });
});

afterEach(cleanup);

describe('useFavoritesCollectionsState', () => {
    it('does not rerender avatar collections when friends change', async () => {
        const { result } = renderCollections('avatar');
        await act(async () => {});
        const before = result.current;

        act(() =>
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_friend',
                patch: { statusDescription: 'Updated' }
            })
        );

        expect(result.current).toBe(before);
        expect(result.current.viewDataInputs.friendsById).toEqual({});
    });

    it.each<FavoriteKind>(['friend', 'world'])(
        'keeps live friends available for %s collections',
        async (kind) => {
            const { result } = renderCollections(kind);
            await act(async () => {});

            act(() =>
                useFriendRosterStore.getState().applyFriendPatch({
                    userId: 'usr_friend',
                    patch: { statusDescription: 'Updated' }
                })
            );

            expect(
                result.current.actionInputs.friendsById.usr_friend
                    .statusDescription
            ).toBe('Updated');
            expect(
                result.current.actionInputs.friendsMap.get('usr_friend')
                    ?.statusDescription
            ).toBe('Updated');
        }
    );
});
