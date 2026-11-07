// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { presenceSection, type PresenceView } from '@/domain/friends/presence';
import type { FriendRecord } from '@/domain/friends/types';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import {
    activePresence,
    offlinePresence,
    onlinePresence
} from '@/test/presenceFixtures';

import * as friendSections from './friendsLocationsSections';
import { useFriendsLocationsPageDerivedState } from './useFriendsLocationsPageDerivedState';

vi.mock('@/lib/useWorldSummaries', () => ({
    useWorldSummaries: () => new Map()
}));

type Section = 'online' | 'active' | 'offline';

function presenceFor(section: Section, location: string): PresenceView {
    if (section === 'online') {
        return onlinePresence(location);
    }
    return section === 'active' ? activePresence() : offlinePresence;
}

function friendAt(place: string | PresenceView): FriendRecord {
    return {
        id: 'usr_friend',
        displayName: 'Friend',
        tags: [],
        $presence: typeof place === 'string' ? onlinePresence(place) : place,
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
            .filter((friend) => presenceSection(friend.$presence) === 'active')
            .map((friend) => friend.id.trim()),
        activeSegment: 'same-instance',
        collapsedGroups: new Set(),
        currentUserId: 'usr_self',
        currentUserSnapshot: null,
        deferredSearchQuery: '',
        density: 'compact',
        viewMode: 'people',
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
            .filter((friend) => presenceSection(friend.$presence) === 'offline')
            .map((friend) => friend.id.trim()),
        onlineIds: friends
            .filter((friend) => presenceSection(friend.$presence) === 'online')
            .map((friend) => friend.id.trim()),
        remoteFavoriteFriendIds: [],
        rosterStatus: 'ready',
        scrollMetrics: { width: 1_000, viewportHeight: 1_000, scrollTop: 0 },
        showFavoritesInOnline: true,
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

    it.each(['same-instance', 'online'] as const)(
        'shows the current user beside one friend in the %s view',
        (activeSegment) => {
            const input = pageInput([friendAt('wrld_local:1')]);
            input.activeSegment = activeSegment;
            input.currentUserSnapshot = {
                id: 'usr_self',
                displayName: 'Me',
                $presence: onlinePresence('wrld_local:1')
            };
            const { result } = renderHook(() =>
                useFriendsLocationsPageDerivedState(input)
            );

            const cards = result.current.visibleVirtualRows.flatMap((row) =>
                row.type === 'cards' ? row.friends : []
            );
            expect(cards.map((friend) => friend.id)).toEqual([
                'usr_self',
                'usr_friend'
            ]);
            expect(cards[0]).toMatchObject({
                displayName: 'Me',
                $presence: onlinePresence('wrld_local:1')
            });
        }
    );

    it('invites from the online presence but keeps the current instance local when the game runs elsewhere', () => {
        const input = pageInput([friendAt('wrld_remote:1')]);
        input.gameState = { currentLocation: '', isGameRunning: false };
        input.currentUserSnapshot = {
            id: 'usr_self',
            displayName: 'Me',
            $presence: onlinePresence('wrld_remote:1')
        };
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        expect(result.current.currentLocation).toBe('');
        expect(result.current.currentInviteLocation).toBe('wrld_remote:1');
        expect(result.current.canSendInvite).toBe(true);
    });

    it.each([
        [true, ['usr_fav', 'usr_plain']],
        [false, ['usr_plain']]
    ] as const)(
        'shows favorite friends in the online view only when enabled (%s)',
        (showFavoritesInOnline, expectedIds) => {
            const input = pageInput([
                { ...friendAt('wrld_away:1'), id: 'usr_fav', displayName: 'A' },
                {
                    ...friendAt('wrld_away:2'),
                    id: 'usr_plain',
                    displayName: 'B'
                }
            ]);
            input.activeSegment = 'online';
            input.remoteFavoriteFriendIds = ['usr_fav'];
            input.showFavoritesInOnline = showFavoritesInOnline;
            const { result } = renderHook(() =>
                useFriendsLocationsPageDerivedState(input)
            );

            expect(
                result.current.visibleVirtualRows
                    .flatMap((row) => (row.type === 'cards' ? row.friends : []))
                    .map((friend) => friend.id)
                    .sort()
            ).toEqual(expectedIds);
        }
    );

    it('groups favorite friends under their own online section', () => {
        const input = pageInput([
            { ...friendAt('wrld_away:1'), id: 'usr_fav', displayName: 'A' },
            { ...friendAt('wrld_away:2'), id: 'usr_plain', displayName: 'B' }
        ]);
        input.activeSegment = 'online';
        input.remoteFavoriteFriendIds = ['usr_fav'];
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        const sections = result.current.visibleVirtualRows.reduce<
            Record<string, string[]>
        >((acc, row) => {
            if (row.type === 'cards') {
                acc[row.section.key] = [
                    ...(acc[row.section.key] ?? []),
                    ...row.friends.map((friend) => friend.id)
                ];
            }
            return acc;
        }, {});
        expect(sections).toEqual({
            'online:favorites': ['usr_fav'],
            'online:remaining': ['usr_plain']
        });
    });

    it('splits online favorite friends by group when the sidebar divides by group', () => {
        const input = pageInput([
            { ...friendAt('wrld_away:1'), id: 'usr_fav', displayName: 'A' },
            { ...friendAt('wrld_away:2'), id: 'usr_plain', displayName: 'B' }
        ]);
        input.activeSegment = 'online';
        input.localFriendFavoriteGroups = ['Besties'];
        input.localFriendFavorites = { Besties: ['usr_fav'] };
        input.sidebarFavoritePrefs = {
            isDivideByGroup: true,
            selectedGroups: [],
            groupOrder: []
        };
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        expect(
            result.current.visibleVirtualRows.flatMap((row) =>
                row.type === 'cards'
                    ? row.friends.map((friend) => [row.section.key, friend.id])
                    : []
            )
        ).toEqual([
            ['online:favorite:local:Besties', 'usr_fav'],
            ['online:remaining', 'usr_plain']
        ]);
    });

    it('does not show a previous account snapshot as the current user', () => {
        const input = pageInput([friendAt('wrld_local:1')]);
        input.currentUserSnapshot = {
            id: 'usr_previous',
            displayName: 'Previous'
        };
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        expect(
            result.current.visibleVirtualRows.flatMap((row) =>
                row.type === 'cards'
                    ? row.friends.map((friend) => friend.id)
                    : []
            )
        ).toEqual(['usr_friend']);
    });

    it.each(['standard', 'compact', 'dense'])(
        'keeps all friends and section headers in the %s density',
        (density) => {
            const friends = Array.from({ length: 8 }, (_, index) => ({
                ...friendAt(index < 6 ? 'wrld_remote:2' : 'private'),
                id: `usr_${index}`
            }));
            const input = pageInput(friends);
            input.activeSegment = 'online';
            input.gameState = undefined;
            input.density = density;
            const { result } = renderHook(() =>
                useFriendsLocationsPageDerivedState(input)
            );
            const cardRows = result.current.visibleVirtualRows.filter(
                (row) => row.type === 'cards'
            );

            expect(cardRows.length).toBeGreaterThan(1);
            expect(
                cardRows
                    .flatMap((row) => row.friends.map((friend) => friend.id))
                    .sort()
            ).toEqual(friends.map((friend) => friend.id).sort());
            expect(
                cardRows.some((row) => row.section.cardContentMode === 'status')
            ).toBe(true);
            const rows = result.current.positionedRows.rows;
            expect(rows.some((row) => row.type === 'header')).toBe(true);
            expect(rows.some((row) => row.type === 'group-header')).toBe(true);
        }
    );

    it('uses distinct card row keys when switching segments', () => {
        const onlineFriend = friendAt('wrld_remote:1');
        const offlineFriend = {
            ...friendAt(offlinePresence),
            id: 'usr_offline',
            displayName: 'Offline Friend'
        };
        const input = pageInput([onlineFriend, offlineFriend]);
        input.activeSegment = 'online';
        input.gameState = undefined;
        const { result, rerender } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        const onlineRow = result.current.visibleVirtualRows.find(
            (row) => row.type === 'cards'
        );
        expect(onlineRow?.key).toBe('cards:online:remaining:0');

        input.activeSegment = 'offline';
        rerender();

        const offlineRow = result.current.visibleVirtualRows.find(
            (row) => row.type === 'cards'
        );
        expect(offlineRow?.key).toBe('cards:flat:0');
        expect(offlineRow?.key).not.toBe(onlineRow?.key);
        expect(
            offlineRow?.type === 'cards'
                ? offlineRow.friends.map((friend) => friend.id)
                : []
        ).toEqual(['usr_offline']);
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
                ...friendAt(presenceFor(state, 'wrld_remote:2')),
                id
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
            expect(friend.$presence).toEqual(
                presenceFor(state, 'wrld_remote:2')
            );
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
            ...friendAt(offlinePresence),
            id: 'usr_m',
            displayName: 'Mary'
        };
        const unrelated: FriendRecord = {
            ...friendAt(offlinePresence),
            id: 'usr_unrelated'
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
            sort.mock.calls.map(([friends]) =>
                friends.map((friend) => friend.id).sort()
            )
        ).toEqual([['usr_a', 'usr_m', 'usr_z']]);
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
                viewMode: 'people',
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
                showFavoritesInOnline: true,
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

describe('useFriendsLocationsPageDerivedState worlds view', () => {
    afterEach(() => {
        cleanup();
        useFriendLocationTimeStore.getState().reset();
        vi.restoreAllMocks();
    });

    function worldFriend(
        id: string,
        location: string,
        section: Section = 'online'
    ): FriendRecord {
        return {
            ...friendAt(presenceFor(section, location)),
            id,
            displayName: id
        };
    }

    it('groups every online friend by world regardless of the active segment', () => {
        const input = pageInput([
            worldFriend('usr_a', 'wrld_hot:1'),
            worldFriend('usr_b', 'wrld_hot:2'),
            worldFriend('usr_c', 'wrld_quiet:1'),
            worldFriend('usr_d', 'private'),
            worldFriend('usr_e', 'wrld_web:1', 'active'),
            worldFriend('usr_f', 'offline', 'offline')
        ]);
        input.activeSegment = 'offline';
        input.viewMode = 'worlds';
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        expect(
            result.current.worldGroups.map(
                (group) => `${group.worldId}:${group.instances.length}`
            )
        ).toEqual(['wrld_hot:2', 'wrld_quiet:1']);
        expect(result.current.hasVisibleSections).toBe(true);
    });

    it('builds no world groups in the people view', () => {
        const input = pageInput([worldFriend('usr_a', 'wrld_hot:1')]);
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        expect(result.current.worldGroups).toEqual([]);
    });

    it('leaves out the current user when no friend shares their instance', () => {
        const input = pageInput([worldFriend('usr_a', 'wrld_other:2')]);
        input.viewMode = 'worlds';
        input.currentUserSnapshot = {
            id: 'usr_self',
            displayName: 'Me',
            $presence: onlinePresence('wrld_local:1')
        };
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        expect(
            result.current.worldGroups.map((group) => group.worldId)
        ).toEqual(['wrld_other']);
        expect(
            result.current.worldGroups[0]?.instances[0]?.friends.map(
                (friend) => friend.id
            )
        ).toEqual(['usr_a']);
    });

    it('keeps the current user inside their own instance', () => {
        const input = pageInput([worldFriend('usr_a', 'wrld_local:1')]);
        input.viewMode = 'worlds';
        input.currentUserSnapshot = {
            id: 'usr_self',
            displayName: 'Me',
            $presence: onlinePresence('wrld_local:1')
        };
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        const instance = result.current.worldGroups[0]?.instances[0];
        expect(instance?.isCurrent).toBe(true);
        expect(instance?.friends.map((friend) => friend.id)).toEqual([
            'usr_self',
            'usr_a'
        ]);
    });

    it('pushes ask me and busy friends to the end of an instance and lists private friends separately', () => {
        const input = pageInput([
            { ...worldFriend('usr_busy', 'wrld_hot:1'), status: 'busy' },
            { ...worldFriend('usr_ask', 'wrld_hot:1'), status: 'ask me' },
            { ...worldFriend('usr_join', 'wrld_hot:1'), status: 'join me' },
            { ...worldFriend('usr_active', 'wrld_hot:1'), status: 'active' },
            worldFriend('usr_private', 'private')
        ]);
        input.viewMode = 'worlds';
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        expect(
            result.current.worldGroups[0]?.instances[0]?.friends.map(
                (friend) => friend.id
            )
        ).toEqual(['usr_join', 'usr_active', 'usr_ask', 'usr_busy']);
        expect(
            result.current.privateWorldFriends.map((friend) => friend.id)
        ).toEqual(['usr_private']);
    });

    it('filters world groups by the search query', () => {
        const input = pageInput([
            worldFriend('usr_a', 'wrld_hot:1'),
            worldFriend('usr_c', 'wrld_quiet:1')
        ]);
        input.viewMode = 'worlds';
        input.deferredSearchQuery = 'usr_c';
        const { result } = renderHook(() =>
            useFriendsLocationsPageDerivedState(input)
        );

        expect(
            result.current.worldGroups.map((group) => group.worldId)
        ).toEqual(['wrld_quiet']);
    });
});
