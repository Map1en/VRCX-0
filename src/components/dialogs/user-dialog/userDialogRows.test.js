import { beforeEach, describe, expect, it } from 'vitest';

import { useShellStore } from '@/state/shellStore.js';

import {
    groupIdForRow,
    groupMemberVisibility,
    normalizeUserGroupMembershipRows,
    sortUserGroupRows,
    splitUserGroups
} from './userDialogGroupRows.js';
import {
    filterRows,
    formatCountText,
    formatDate,
    formatStatsDate,
    formatStatsDuration,
    groupDisplayName,
    hydrateMutualFriendRows,
    isOfflineLikeValue,
    normalizeLanguageRows,
    normalizePreviousDisplayNames,
    resolveStatusStateText,
    resolveTabValue,
    sortAvatarRows,
    sortMutualFriendRows,
    summarizeEntityRow,
    userIdForRow,
    userTravelingTimestamp,
    worldOccupantSubtitle
} from './userDialogRows.js';

describe('userDialogRows', () => {
    beforeEach(() => {
        useShellStore.setState({
            dateCulture: 'en-gb',
            dateIsoFormat: true,
            dateHour12: false
        });
    });

    it('shows matching rows when a user searches dialog lists', () => {
        const rows = [
            { id: 'wrld_a', name: 'Treehouse', description: 'Quiet hangout' },
            { id: 'avtr_b', avatarName: 'Quest Robot', authorName: 'Maker' },
            { id: 'wrld_c', name: 'Club', $favoriteGroup: 'Weekend picks' }
        ];

        expect(filterRows(rows, 'quest').map((row) => row.id)).toEqual([
            'avtr_b'
        ]);
        expect(filterRows(rows, 'weekend').map((row) => row.id)).toEqual([
            'wrld_c'
        ]);
    });

    it('resolves user ids from dialog row shapes used by instance occupants', () => {
        expect(userIdForRow({ id: 'usr_direct' })).toBe('usr_direct');
        expect(userIdForRow({ userId: 'usr_user_id' })).toBe('usr_user_id');
        expect(userIdForRow({ targetUserId: 'usr_target' })).toBe('usr_target');
        expect(userIdForRow(null)).toBe('');
    });

    it('orders avatar rows by the selected visible sort', () => {
        const rows = [
            {
                id: 'avtr_c',
                name: 'Cedar',
                updated_at: '2026-01-01T00:00:00.000Z',
                created_at: '2025-01-01T00:00:00.000Z'
            },
            {
                id: 'avtr_a',
                name: 'Aspen',
                updated_at: '2026-03-01T00:00:00.000Z',
                created_at: '2023-01-01T00:00:00.000Z'
            },
            {
                id: 'avtr_b',
                name: 'Birch',
                updated_at: '2026-02-01T00:00:00.000Z',
                created_at: '2024-01-01T00:00:00.000Z'
            }
        ];

        expect(sortAvatarRows(rows, 'name').map((row) => row.id)).toEqual([
            'avtr_a',
            'avtr_b',
            'avtr_c'
        ]);
        expect(sortAvatarRows(rows, 'update').map((row) => row.id)).toEqual([
            'avtr_a',
            'avtr_b',
            'avtr_c'
        ]);
        expect(sortAvatarRows(rows, 'createdAt').map((row) => row.id)).toEqual([
            'avtr_c',
            'avtr_b',
            'avtr_a'
        ]);
    });

    it('shows mutual friends with roster details while keeping dialog friend order', () => {
        const hydrated = hydrateMutualFriendRows(
            [
                { id: 'usr_alice', $friendNumber: 2, status: 'active' },
                { id: 'usr_bob', friendNumber: 5 }
            ],
            {
                usr_alice: {
                    id: 'usr_alice',
                    displayName: 'Alice',
                    $friendNumber: 99,
                    last_activity: '2026-01-01'
                },
                usr_bob: {
                    id: 'usr_bob',
                    displayName: 'Bob',
                    $friendNumber: 1,
                    last_activity: '2026-01-02'
                }
            }
        );

        expect(hydrated).toEqual([
            {
                id: 'usr_alice',
                displayName: 'Alice',
                $friendNumber: 2,
                friendNumber: 2,
                last_activity: '2026-01-01',
                status: 'active'
            },
            {
                id: 'usr_bob',
                displayName: 'Bob',
                $friendNumber: 5,
                friendNumber: 5,
                last_activity: '2026-01-02'
            }
        ]);
        expect(
            sortMutualFriendRows(hydrated, 'friendOrder').map((row) => row.id)
        ).toEqual(['usr_bob', 'usr_alice']);
        expect(
            sortMutualFriendRows(hydrated, 'alphabetical').map((row) => row.id)
        ).toEqual(['usr_alice', 'usr_bob']);
    });

    it('orders mutual friends by their latest visible activity', () => {
        expect(
            sortMutualFriendRows(
                [
                    {
                        id: 'usr_old',
                        displayName: 'Old Friend',
                        last_activity: '2026-01-01T00:00:00.000Z'
                    },
                    {
                        id: 'usr_new',
                        displayName: 'New Friend',
                        last_activity: '2026-03-01T00:00:00.000Z'
                    },
                    {
                        id: 'usr_mid',
                        displayName: 'Mid Friend',
                        last_activity: '2026-02-01T00:00:00.000Z'
                    }
                ],
                'lastActive'
            ).map((row) => row.id)
        ).toEqual(['usr_new', 'usr_mid', 'usr_old']);
    });

    it('normalizes user groups for the visible owned, mutual, and remaining sections', () => {
        const groups = normalizeUserGroupMembershipRows([
            {
                id: 'grp_owned',
                name: 'Owned Group',
                ownerId: 'usr_me',
                memberCount: 2
            },
            {
                id: 'gmem_1',
                group: {
                    id: 'grp_mutual',
                    name: 'Mutual Group',
                    memberCount: 8
                },
                mutualGroup: true,
                memberVisibility: 'friends'
            },
            { id: 'grp_regular', name: 'Regular Group', memberCount: 4 }
        ]);

        expect(groups.map(groupIdForRow)).toEqual([
            'grp_owned',
            'grp_mutual',
            'grp_regular'
        ]);
        expect(groupMemberVisibility(groups[1])).toBe('friends');
        expect(groupDisplayName(groups[1])).toBe('Mutual Group');
        expect(
            sortUserGroupRows(groups, 'inGame', [
                'grp_regular',
                'grp_owned'
            ]).map(groupIdForRow)
        ).toEqual(['grp_regular', 'grp_owned', 'grp_mutual']);
        expect(
            sortUserGroupRows(groups, 'alphabetical').map(groupIdForRow)
        ).toEqual(['grp_mutual', 'grp_owned', 'grp_regular']);
        expect(sortUserGroupRows(groups, 'members').map(groupIdForRow)).toEqual(
            ['grp_owned', 'grp_regular', 'grp_mutual']
        );

        const sections = splitUserGroups(groups, 'usr_me', false);
        expect(sections.ownGroups.map(groupIdForRow)).toEqual(['grp_owned']);
        expect(sections.mutualGroups.map(groupIdForRow)).toEqual([
            'grp_mutual'
        ]);
        expect(sections.remainingGroups.map(groupIdForRow)).toEqual([
            'grp_regular'
        ]);
    });

    it('combines explicit profile languages and language tags once for the title row', () => {
        expect(
            normalizeLanguageRows(
                ['eng', { key: 'jpn', value: 'Japanese' }],
                ['language_jpn', 'language_spa', 'system_supporter']
            )
        ).toEqual([
            { key: 'eng', value: 'eng' },
            { key: 'jpn', value: 'Japanese' },
            { key: 'spa', value: 'spa' }
        ]);
    });

    it('shows previous display names from profile history or cached stats', () => {
        expect(
            normalizePreviousDisplayNames(
                new Map([
                    ['Old Name', '2026-01-02T03:04:05.000Z'],
                    ['Older Name', '']
                ])
            )
        ).toEqual([
            { displayName: 'Old Name', updated_at: '2026-01-02T03:04:05.000Z' },
            { displayName: 'Older Name', updated_at: '' }
        ]);

        expect(
            normalizePreviousDisplayNames([
                'Legacy Name',
                { name: 'Past Name', date: '2025-01-01' }
            ])
        ).toEqual([
            { displayName: 'Legacy Name', updated_at: '' },
            { displayName: 'Past Name', updated_at: '2025-01-01' }
        ]);
    });

    it('uses readable fallback text for empty stats and unavailable locations', () => {
        expect(formatDate('')).toBe('\u2014');
        expect(formatDate('not-a-date')).toBe('not-a-date');
        expect(formatStatsDate('2026-01-02T03:04:05')).toBe(
            '2026-01-02 03:04:05'
        );
        expect(formatStatsDuration(0)).toBe('\u2014');
        expect(formatCountText(3, 5)).toBe('3/5');
        expect(formatCountText(3, 0)).toBe('3');
        expect(isOfflineLikeValue('private')).toBe(true);
        expect(isOfflineLikeValue('wrld_123:456')).toBe(false);
    });

    it('resolves visible labels for rows, status, tabs, worlds, and traveling users', () => {
        expect(summarizeEntityRow('wrld_hidden')).toBe('\u2014');
        expect(
            summarizeEntityRow({ name: 'World', $favoriteGroup: 'Favorites' })
        ).toBe('Favorites: World');
        expect(worldOccupantSubtitle({ occupants: 12 })).toBe('(12)');
        expect(
            resolveStatusStateText({ state: 'active', status: 'join me' })
        ).toBe('active / join me');
        expect(
            resolveStatusStateText({ state: 'active', status: 'active' })
        ).toBe('active');
        expect(
            resolveTabValue([{ value: 'info' }, { value: 'groups' }], 'groups')
        ).toBe('groups');
        expect(resolveTabValue([{ value: 'info' }], 'groups')).toBe('info');
        expect(
            userTravelingTimestamp({
                location: 'traveling',
                travelingToTime: 12345
            })
        ).toBe(12345);
    });
});
