import { describe, expect, it } from 'vitest';

import {
    buildFavoriteGroupLabelsByFriendId,
    buildFriendSections,
    compareFavoriteGroups,
    sortActiveFriendsBySidebarPrefs,
    sortFriendsBySidebarPrefs
} from './friendsLocationsSections';

describe('friends locations section helpers', () => {
    it('builds a flat section without regrouping friends', () => {
        const friends = [
            { id: 'usr_1', displayName: 'Maple' },
            { id: 'usr_2', displayName: 'Cedar' }
        ];

        expect(
            buildFriendSections({
                friends,
                groupingMode: 'flat',
                favoriteIds: new Set(),
                favoriteGroupLabelsByFriendId: new Map()
            })
        ).toEqual([
            {
                key: 'flat',
                title: 'All matching friends',
                description: '',
                friends,
                worldId: '',
                groupId: ''
            }
        ]);
    });

    it('groups friends by favorite group labels with favorite fallback and no-group bucket', () => {
        const remoteFavoriteLabels = buildFavoriteGroupLabelsByFriendId({
            favoriteFriendGroups: [
                { key: 'group_a', displayName: 'Raid Team' }
            ],
            groupedFavoriteFriendIdsByGroupKey: { group_a: ['usr_1'] },
            localFriendFavorites: { Local: ['usr_2'] }
        });
        const friends = [
            { id: 'usr_1', displayName: 'Remote Favorite' },
            { id: 'usr_2', displayName: 'Local Favorite' },
            { id: 'usr_3', displayName: 'Ungrouped Favorite' },
            { id: 'usr_4', displayName: 'No Group' }
        ];

        const sections = buildFriendSections({
            friends,
            groupingMode: 'favoriteGroup',
            favoriteIds: new Set(['usr_3']),
            favoriteGroupLabelsByFriendId: remoteFavoriteLabels
        });

        expect(
            sections.map((section) => ({
                key: section.key,
                title: section.title,
                friends: section.friends.map((friend) => friend.id)
            }))
        ).toEqual([
            {
                key: 'favorite:Favorites',
                title: 'Favorites',
                friends: ['usr_3']
            },
            {
                key: 'favorite:Local: Local',
                title: 'Local: Local',
                friends: ['usr_2']
            },
            {
                key: 'favorite:No favorite group',
                title: 'No favorite group',
                friends: ['usr_4']
            },
            {
                key: 'favorite:Raid Team',
                title: 'Raid Team',
                friends: ['usr_1']
            }
        ]);
    });

    it('groups instance sections and keeps offline at the bottom', () => {
        const friends = [
            {
                id: 'usr_offline',
                displayName: 'Offline',
                location: 'offline'
            },
            {
                id: 'usr_public',
                displayName: 'Public',
                location: 'wrld_public:123~group(grp_1)',
                worldName: 'Club Orion',
                groupName: 'Orion Group'
            },
            {
                id: 'usr_private',
                displayName: 'Private',
                location: 'private'
            }
        ];

        const sections = buildFriendSections({
            friends,
            groupingMode: 'instance',
            favoriteIds: new Set(),
            favoriteGroupLabelsByFriendId: new Map()
        });

        expect(sections.map((section) => section.key)).toEqual([
            'instance:wrld_public:123~group(grp_1)',
            'instance:private:private',
            'instance:offline'
        ]);
        expect(sections[0].title).toBe('Club Orion');
        expect(sections[0].description).toContain('Orion Group');
    });

    it('sorts friends by sidebar preferences without mutating the input array', () => {
        const friends = [
            { id: 'usr_2', displayName: 'Beta' },
            { id: 'usr_1', displayName: 'Alpha' }
        ];

        const sorted = sortFriendsBySidebarPrefs(friends, [
            'Sort Alphabetically'
        ]);

        expect(sorted.map((friend) => friend.id)).toEqual(['usr_1', 'usr_2']);
        expect(friends.map((friend) => friend.id)).toEqual(['usr_2', 'usr_1']);
    });

    it('sorts active friends by status after sidebar preferences', () => {
        const friends = [
            { id: 'usr_busy', displayName: 'Busy', status: 'busy' },
            { id: 'usr_active', displayName: 'Active', status: 'active' },
            { id: 'usr_join', displayName: 'Join', status: 'joinme' },
            { id: 'usr_ask', displayName: 'Ask', status: 'askme' }
        ];

        expect(
            sortActiveFriendsBySidebarPrefs(friends, [
                'Sort Alphabetically'
            ]).map((friend) => friend.id)
        ).toEqual(['usr_join', 'usr_active', 'usr_ask', 'usr_busy']);
    });

    it('orders configured favorite groups before label fallback ordering', () => {
        const rows = [
            { key: 'group_b', label: 'Beta' },
            { key: 'group_a', label: 'Alpha' },
            { key: 'group_c', label: 'Aardvark' }
        ];

        expect(
            [...rows]
                .sort((left, right) =>
                    compareFavoriteGroups(left, right, ['group_b'])
                )
                .map((row) => row.key)
        ).toEqual(['group_b', 'group_c', 'group_a']);
    });
});
