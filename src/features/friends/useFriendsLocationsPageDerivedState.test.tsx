// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FriendRecord } from '@/domain/friends/types';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';

import * as friendSections from './friendsLocationsSections';
import { useFriendsLocationsPageDerivedState } from './useFriendsLocationsPageDerivedState';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

function friendAt(location: string): FriendRecord {
    return {
        id: 'usr_friend',
        displayName: 'Friend',
        tags: [],
        state: 'online',
        stateBucket: 'online',
        location,
        $trustLevel: '',
        $friendNumber: 0,
        $trustClass: '',
        $trustSortNum: 0,
        $isModerator: false,
        $isTroll: false,
        $isProbableTroll: false,
        $platform: ''
    };
}

function pageInput(
    friends: FriendRecord[]
): Parameters<typeof useFriendsLocationsPageDerivedState>[0] {
    return {
        activeIds: friends
            .filter((friend) => friend.state === 'active')
            .map((friend) => friend.id.trim()),
        activeSegment: 'same-instance',
        collapsedGroups: new Set(),
        currentUserId: 'usr_self',
        currentUserSnapshot: null,
        deferredSearchQuery: '',
        density: 'compact',
        favoriteFriendGroups: [],
        friendsById: Object.fromEntries(
            friends.map((friend) => [friend.id.trim(), friend])
        ),
        gameState: {
            currentLocation: 'wrld_local:1',
            currentLocationPlayerIds: friends.map((friend) => friend.id.trim()),
            isGameRunning: true
        },
        groupedFavoriteFriendIdsByGroupKey: {},
        localFriendFavoriteGroups: [],
        localFriendFavorites: {},
        offlineIds: friends
            .filter((friend) => friend.state === 'offline')
            .map((friend) => friend.id.trim()),
        onlineIds: friends
            .filter((friend) => friend.state === 'online')
            .map((friend) => friend.id.trim()),
        remoteFavoriteFriendIds: [],
        rosterStatus: 'ready',
        scrollMetrics: { width: 1_000, viewportHeight: 1_000, scrollTop: 0 },
        showCurrentUserInSameInstance: true,
        showSameInstanceInOnline: true,
        sidebarFavoritePrefs: {
            isDivideByGroup: false,
            selectedGroups: [],
            groupOrder: []
        },
        sidebarSortMethods: []
    };
}

describe('useFriendsLocationsPageDerivedState', () => {
    afterEach(() => {
        cleanup();
        useFriendLocationTimeStore.getState().reset();
        vi.restoreAllMocks();
    });

    it.each([
        ['online', 'usr_friend'],
        ['active', 'usr_friend'],
        ['offline', 'usr_friend'],
        ['active', ' usr_friend '],
        ['offline', ' usr_friend ']
    ] as const)(
        'groups a locally observed friend despite remote %s presence with id "%s" and releases it after leaving',
        (state, id) => {
            const location = 'wrld_local:1';
            const friend = {
                ...friendAt('wrld_remote:2'),
                id,
                state,
                stateBucket: state
            };
            useFriendLocationTimeStore.getState().replaceSnapshot([
                {
                    userId: friend.id,
                    location,
                    sinceMs: 1_000,
                    source: 'gameLog'
                }
            ]);
            const input = pageInput([friend]);
            const { result, rerender } = renderHook(() =>
                useFriendsLocationsPageDerivedState(input)
            );

            const card = result.current.visibleVirtualRows.find(
                (row) => row.type === 'cards'
            );
            expect(card?.section.rawLocation).toBe(location);
            expect(card?.type === 'cards' && card.friends[0]).toBe(friend);
            if (state !== 'online') {
                input.activeSegment = state;
                rerender();
                expect(result.current.hasVisibleSections).toBe(false);
            }

            act(() =>
                useFriendLocationTimeStore.getState().replaceSnapshot([
                    {
                        userId: friend.id,
                        location: 'wrld_remote:2',
                        sinceMs: 10_000,
                        source: 'realtime'
                    }
                ])
            );
            input.activeSegment = 'same-instance';
            rerender();
            expect(result.current.hasVisibleSections).toBe(false);
            if (state !== 'online') {
                input.activeSegment = state;
                rerender();
                expect(result.current.hasVisibleSections).toBe(true);
            }
            expect(friend.location).toBe('wrld_remote:2');
            expect(friend.state).toBe(state);
        }
    );

    it('only sorts online and locally observed friends on timer updates and preserves their order', () => {
        const onlineFirst = {
            ...friendAt('wrld_local:1'),
            id: 'usr_a',
            displayName: 'Alice'
        };
        const onlineLast = {
            ...friendAt('wrld_local:1'),
            id: 'usr_z',
            displayName: 'Zoe'
        };
        const local: FriendRecord = {
            ...friendAt('wrld_remote:2'),
            id: 'usr_m',
            displayName: 'Mary',
            state: 'offline'
        };
        const unrelated: FriendRecord = {
            ...friendAt('offline'),
            id: 'usr_unrelated',
            state: 'offline'
        };
        const input = pageInput([onlineLast, unrelated, local, onlineFirst]);
        input.sidebarSortMethods = ['Sort Alphabetically'];
        const sort = vi.spyOn(friendSections, 'sortFriendsBySidebarPrefs');
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: local.id,
                location: 'wrld_local:1',
                sinceMs: 1_000,
                source: 'gameLog'
            },
            {
                userId: onlineFirst.id,
                location: 'wrld_local:1',
                sinceMs: 1_000,
                source: 'gameLog'
            }
        ]);
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );
        expect(
            result.current.visibleVirtualRows.flatMap((row) =>
                row.type === 'cards'
                    ? row.friends.map((friend) => friend.id)
                    : []
            )
        ).toEqual(['usr_a', 'usr_m', 'usr_z']);
        sort.mockClear();

        act(() =>
            useFriendLocationTimeStore.getState().replaceSnapshot([
                {
                    userId: local.id,
                    location: 'wrld_local:1',
                    sinceMs: 2_000,
                    source: 'gameLog'
                },
                {
                    userId: onlineFirst.id,
                    location: 'wrld_local:1',
                    sinceMs: 1_000,
                    source: 'gameLog'
                }
            ])
        );

        expect(
            sort.mock.calls.flatMap(([friends]) =>
                friends.map((friend) => friend.id)
            )
        ).not.toContain(unrelated.id);
        expect(
            result.current.visibleVirtualRows.flatMap((row) =>
                row.type === 'cards'
                    ? row.friends.map((friend) => friend.id)
                    : []
            )
        ).toEqual(['usr_a', 'usr_m', 'usr_z']);
        sort.mockClear();

        act(() =>
            useFriendLocationTimeStore.getState().replaceSnapshot([
                {
                    userId: local.id,
                    location: 'wrld_remote:2',
                    sinceMs: 3_000,
                    source: 'realtime'
                },
                {
                    userId: onlineFirst.id,
                    location: 'wrld_local:1',
                    sinceMs: 1_000,
                    source: 'gameLog'
                }
            ])
        );

        expect(sort).not.toHaveBeenCalled();
        expect(
            result.current.visibleVirtualRows.flatMap((row) =>
                row.type === 'cards'
                    ? row.friends.map((friend) => friend.id)
                    : []
            )
        ).toEqual(['usr_a', 'usr_z']);
    });

    it('does not synthesize a friend dwell start from the local roster', () => {
        const location = 'wrld_test:123';
        const joinedAtMs = 1_700_000_000_000;
        const friend = friendAt(location);
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState({
                activeIds: [friend.id],
                activeSegment: 'online',
                collapsedGroups: new Set(),
                currentUserId: 'usr_self',
                currentUserSnapshot: null,
                deferredSearchQuery: 'Friend',
                density: 'compact',
                favoriteFriendGroups: [],
                friendsById: { [friend.id]: friend },
                gameState: {
                    currentLocation: location,
                    currentLocationPlayerIds: [friend.id],
                    currentLocationPlayers: [
                        {
                            id: friend.id,
                            userId: friend.id,
                            displayName: friend.displayName,
                            joinedAt: new Date(joinedAtMs).toISOString(),
                            joinedAtMs
                        }
                    ],
                    isGameRunning: true
                },
                groupedFavoriteFriendIdsByGroupKey: {},
                localFriendFavoriteGroups: [],
                localFriendFavorites: {},
                offlineIds: [],
                onlineIds: [],
                remoteFavoriteFriendIds: [],
                rosterStatus: 'ready',
                scrollMetrics: {
                    width: 1000,
                    viewportHeight: 1000,
                    scrollTop: 0
                },
                showCurrentUserInSameInstance: true,
                showSameInstanceInOnline: true,
                sidebarFavoritePrefs: {
                    isDivideByGroup: false,
                    selectedGroups: [],
                    groupOrder: []
                },
                sidebarSortMethods: []
            })
        );

        const cardRow = result.current.visibleVirtualRows.find(
            (row) => row.type === 'cards'
        );
        expect(cardRow?.type).toBe('cards');
        if (cardRow?.type !== 'cards') {
            return;
        }
        expect(cardRow.friends[0]?.$location_at).toBeUndefined();
    });
});
