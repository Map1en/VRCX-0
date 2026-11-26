import { describe, expect, it } from 'vitest';

import {
    offlinePresence,
    onlinePresence,
    pendingPresence
} from '@/test/presenceFixtures';

import {
    buildFavoriteGroupItems,
    buildFavoriteGroupLabelsByUserId,
    buildFriendsInCurrentInstanceIds,
    displayNameForUser,
    onlineFriendIdsFromGroup,
    pushUniqueLabel
} from './inviteDialogModel';

function localGroup(id: number, name: string) {
    return { id, kind: 'friend' as const, name, shared: false };
}

describe('inviteDialogModel', () => {
    const friendsById = {
        usr_online_display: {
            id: 'usr_online_display',
            $presence: onlinePresence(),
            displayName: 'Online Display'
        },
        usr_online_username: {
            id: 'usr_online_username',
            $presence: pendingPresence(),
            username: 'Online Username'
        },
        usr_offline: {
            id: 'usr_offline',
            $presence: offlinePresence,
            name: 'Offline Friend'
        },
        usr_name_only: {
            id: 'usr_name_only',
            $presence: onlinePresence(),
            name: 'Name Only'
        }
    };

    it('keeps unique online friend ids in input order', () => {
        expect(
            onlineFriendIdsFromGroup(
                [
                    ' usr_online_display ',
                    'usr_online_username',
                    'usr_online_display',
                    'usr_offline',
                    '',
                    'usr_missing'
                ],
                friendsById
            )
        ).toEqual(['usr_online_display', 'usr_online_username']);
    });

    it('resolves display names through self and friend fallbacks', () => {
        expect(
            displayNameForUser('usr_self', friendsById, {
                id: 'usr_self',
                displayName: 'Self Display',
                username: 'self_name'
            })
        ).toBe('Self Display');
        expect(
            displayNameForUser('usr_self', friendsById, {
                id: 'usr_self',
                username: 'self_name'
            })
        ).toBe('self_name');
        expect(
            displayNameForUser('usr_self', friendsById, { id: 'usr_self' })
        ).toBe('usr_self');
        expect(
            displayNameForUser('usr_online_display', friendsById, null)
        ).toBe('Online Display');
        expect(
            displayNameForUser('usr_online_username', friendsById, null)
        ).toBe('Online Username');
        expect(displayNameForUser('usr_name_only', friendsById, null)).toBe(
            'Name Only'
        );
        expect(displayNameForUser('usr_unknown', friendsById, null)).toBe(
            'usr_unknown'
        );
    });

    it('pushes unique non-empty labels in insertion order', () => {
        const labels = ['Existing'];

        pushUniqueLabel(labels, ' New ');
        pushUniqueLabel(labels, 'Existing');
        pushUniqueLabel(labels, '');
        pushUniqueLabel(labels, '');
        pushUniqueLabel(labels, 'Another');

        expect(labels).toEqual(['Existing', 'New', 'Another']);
    });

    it('builds favorite group labels per user from remote and local sources', () => {
        expect(
            buildFavoriteGroupLabelsByUserId({
                favoriteFriendGroups: [
                    { key: 'group_remote', displayName: 'Remote Group' },
                    { key: 'group_duplicate', displayName: 'Shared Group' }
                ],
                groupedFavoriteFriendIdsByGroupKey: {
                    group_remote: [
                        'usr_online_display',
                        ' usr_online_username ',
                        ''
                    ],
                    group_duplicate: ['usr_online_display']
                },
                localFriendFavoriteGroups: [
                    localGroup(1, 'Local Group'),
                    localGroup(2, 'Shared Group')
                ],
                localFriendFavorites: {
                    1: ['usr_online_display', 'usr_name_only'],
                    2: ['usr_online_display']
                }
            })
        ).toEqual({
            usr_online_display: ['Remote Group', 'Shared Group', 'Local Group'],
            usr_online_username: ['Remote Group'],
            usr_name_only: ['Local Group']
        });
    });

    it('keeps known friends in current instance and dedupes, regardless of online state', () => {
        expect(
            buildFriendsInCurrentInstanceIds({
                currentLocationPlayerIds: [
                    ' usr_online_display ',
                    'usr_online_display',
                    'usr_offline',
                    'usr_missing',
                    ''
                ],
                friendsById
            })
        ).toEqual(['usr_online_display', 'usr_offline']);
    });

    it('builds favorite group menu items with online friends and filters empty groups', () => {
        expect(
            buildFavoriteGroupItems({
                favoriteFriendGroups: [
                    { key: 'remote_online', displayName: 'Remote Online' },
                    { key: 'remote_empty', displayName: 'Remote Empty' }
                ],
                groupedFavoriteFriendIdsByGroupKey: {
                    remote_online: [
                        'usr_online_display',
                        'usr_offline',
                        'usr_online_username',
                        'usr_online_display'
                    ],
                    remote_empty: ['usr_offline']
                },
                localFriendFavoriteGroups: [
                    localGroup(3, 'Local Online'),
                    localGroup(4, 'Local Empty')
                ],
                localFriendFavorites: {
                    3: ['usr_name_only', 'usr_missing'],
                    4: ['usr_offline']
                },
                friendsById
            })
        ).toEqual({
            remote: [
                {
                    key: 'remote:remote_online',
                    label: 'Remote Online',
                    userIds: ['usr_online_display', 'usr_online_username']
                }
            ],
            local: [
                {
                    key: 'local:3',
                    label: 'Local Online',
                    userIds: ['usr_name_only']
                }
            ]
        });
    });

    it('returns no local groups when the local group list is missing', () => {
        expect(
            buildFavoriteGroupItems({
                favoriteFriendGroups: [],
                groupedFavoriteFriendIdsByGroupKey: {},
                localFriendFavoriteGroups: undefined,
                localFriendFavorites: {
                    'Group A': ['usr_online_display']
                },
                friendsById
            })
        ).toEqual({ remote: [], local: [] });
    });
});
