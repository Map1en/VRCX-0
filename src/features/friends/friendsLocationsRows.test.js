import { describe, expect, it } from 'vitest';

import {
    buildFavoriteGroupLabelsByFriendId,
    buildSameInstanceGroups,
    compareFavoriteGroups,
    isOnlineFriend,
    normalizeDisplayText,
    normalizeFriendsLocationId,
    resolveDisplayWorldName,
    resolveFavoriteGroupLabels,
    resolveFriendsLocationsCurrentInviteLocation,
    resolveFriendGroupName,
    resolveLocationSummary,
    resolveWorldDialogTarget,
    uniqueFriendsById
} from './friendsLocationsRows.js';
import {
    buildFriendsLocationsFavoriteIdSet,
    matchesFriendLocationSearch
} from './friendsLocationsSearch.js';

describe('friends locations row helpers', () => {
    it('normalizes ids and display text from strings and location-like objects', () => {
        expect(normalizeFriendsLocationId('  usr_1  ')).toBe('usr_1');
        expect(normalizeFriendsLocationId({ tag: 'wrld_1:123' })).toBe(
            'wrld_1:123'
        );
        expect(
            normalizeFriendsLocationId({ worldId: 'wrld_1', instanceId: '123' })
        ).toBe('wrld_1:123');
        expect(normalizeFriendsLocationId({ isPrivate: true })).toBe('private');
        expect(
            normalizeDisplayText({ $location: { worldName: 'World Name' } })
        ).toBe('World Name');
    });

    it('prefers readable world and group names over raw ids', () => {
        expect(resolveDisplayWorldName('wrld_123', 'Club Orion')).toBe(
            'Club Orion'
        );
        expect(
            resolveFriendGroupName({
                $location: {
                    group: {
                        displayName: 'Group Display'
                    }
                }
            })
        ).toBe('Group Display');
    });

    it('deduplicates friends by id while keeping anonymous rows', () => {
        const first = { id: 'usr_1', displayName: 'First' };
        const duplicate = { id: 'usr_1', displayName: 'Duplicate' };
        const anonymous = { displayName: 'Anonymous' };

        expect(uniqueFriendsById([first, duplicate, anonymous])).toEqual([
            first,
            anonymous
        ]);
    });

    it('resolves invite location and online status from session-visible fields', () => {
        expect(
            resolveFriendsLocationsCurrentInviteLocation(
                {
                    currentLocation: 'traveling',
                    currentDestination: 'wrld_dest:123'
                },
                { location: 'wrld_profile:456' }
            )
        ).toBe('wrld_dest:123');
        expect(
            resolveFriendsLocationsCurrentInviteLocation(
                {},
                { $locationTag: 'wrld_profile:456' }
            )
        ).toBe('wrld_profile:456');
        expect(isOnlineFriend({ stateBucket: 'online' })).toBe(true);
        expect(isOnlineFriend({ status: 'active' })).toBe(true);
        expect(isOnlineFriend({ state: 'offline' })).toBe(false);
    });

    it('builds favorite ids and labels from remote and local favorite groups', () => {
        const labels = buildFavoriteGroupLabelsByFriendId({
            favoriteFriendGroups: [
                { key: 'group_a', displayName: 'Best Friends' }
            ],
            groupedFavoriteFriendIdsByGroupKey: { group_a: ['usr_1'] },
            localFriendFavorites: { Local: ['usr_2'] }
        });
        const favoriteIds = buildFriendsLocationsFavoriteIdSet(['usr_1'], {
            Local: ['usr_2', '']
        });

        expect(labels.get('usr_1')).toEqual(['Best Friends']);
        expect(labels.get('usr_2')).toEqual(['Local: Local']);
        expect([...favoriteIds]).toEqual(['usr_1', 'usr_2']);
        expect(
            resolveFavoriteGroupLabels({ id: 'usr_1' }, labels, favoriteIds)
        ).toEqual(['Best Friends']);
        expect(
            resolveFavoriteGroupLabels({ id: 'usr_2' }, new Map(), favoriteIds)
        ).toEqual(['Favorites']);
    });

    it('groups friends who share the same concrete instance location', () => {
        const sharedLocation = 'wrld_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:123';
        const soloLocation = 'wrld_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:456';
        const first = {
            id: 'usr_1',
            displayName: 'First',
            location: sharedLocation
        };
        const second = {
            id: 'usr_2',
            displayName: 'Second',
            location: sharedLocation
        };
        const solo = {
            id: 'usr_3',
            displayName: 'Solo',
            location: soloLocation
        };

        expect(buildSameInstanceGroups([first, solo, second])).toEqual([
            {
                location: sharedLocation,
                friends: [first, second]
            }
        ]);
    });

    it('matches search text against friend and location summary fields', () => {
        const favoriteIds = new Set(['usr_1']);
        const friend = {
            id: 'usr_1',
            displayName: 'Maple',
            username: 'maple_user',
            statusDescription: 'At the club',
            worldId: 'wrld_1',
            location: 'offline'
        };

        expect(matchesFriendLocationSearch(friend, 'maple', favoriteIds)).toBe(
            true
        );
        expect(
            matchesFriendLocationSearch(friend, 'favorite', favoriteIds)
        ).toBe(true);
        expect(
            matchesFriendLocationSearch(friend, 'missing', favoriteIds)
        ).toBe(false);
    });

    it('resolves offline/private/traveling summaries and world dialog targets', () => {
        expect(resolveLocationSummary({ location: 'offline' })).toEqual({
            label: 'Offline',
            meta: ''
        });
        expect(resolveLocationSummary({ location: 'private' })).toEqual({
            label: 'Private',
            meta: ''
        });
        const publicSummary = resolveLocationSummary({
            location: 'wrld_123:Room~group(grp_1)',
            worldName: 'Club Orion',
            groupName: 'Orion Group'
        });
        expect(publicSummary.label).toBe('Club Orion');
        expect(publicSummary.meta).toContain('Room');
        expect(resolveWorldDialogTarget({ rawLocation: 'wrld_123:456' })).toBe(
            'wrld_123:456'
        );
    });

    it('sorts favorite groups by configured order before display label', () => {
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
