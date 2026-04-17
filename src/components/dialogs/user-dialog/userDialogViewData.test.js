import { beforeEach, describe, expect, it } from 'vitest';

import { useShellStore } from '@/state/shellStore.js';
import { resolveTabValue } from './userDialogRows.js';
import {
    buildUserDialogListViewData,
    buildUserDialogProfileSummary,
    buildUserDialogTabs
} from './userDialogViewData.js';

describe('userDialogViewData', () => {
    beforeEach(() => {
        useShellStore.setState({
            dateCulture: 'en-gb',
            dateIsoFormat: true,
            dateHour12: false
        });
    });

    it('builds the tabs available for the viewed user', () => {
        const otherUserTabs = buildUserDialogTabs({
            isCurrentUser: false,
            currentUserHasSharedConnectionsOptOut: false
        });
        const currentUserTabs = buildUserDialogTabs({
            isCurrentUser: true,
            currentUserHasSharedConnectionsOptOut: false
        });

        expect(otherUserTabs.map((tab) => tab.value)).toEqual([
            'info',
            'mutual',
            'groups',
            'worlds',
            'favorite-worlds',
            'avatars',
            'activity',
            'json'
        ]);
        expect(currentUserTabs.map((tab) => tab.value)).toEqual([
            'info',
            'groups',
            'worlds',
            'activity',
            'json'
        ]);
        expect(resolveTabValue(currentUserTabs, 'avatars')).toBe('info');
    });

    it('prepares visible list rows from remote data, search, selection, and sort choices', () => {
        const selectedGroupIds = new Set(['grp_beta']);
        const viewData = buildUserDialogListViewData({
            profile: {
                groups: [{ id: 'grp_profile', name: 'Profile Group' }],
                worlds: [
                    { id: 'wrld_tree', name: 'Treehouse' },
                    { id: 'wrld_club', name: 'Club' }
                ],
                favoriteWorlds: [
                    { id: 'wrld_profile_fav', name: 'Profile Favorite' }
                ],
                avatars: [{ id: 'avtr_profile', name: 'Profile Avatar' }],
                bioLinks: ['https://example.test/profile']
            },
            remoteData: {
                groups: [
                    { id: 'grp_beta', name: 'Beta Group', memberCount: 2 },
                    { id: 'grp_alpha', name: 'Alpha Group', memberCount: 3 }
                ],
                mutual: [
                    { id: 'usr_alice', displayName: 'Alice' },
                    { id: 'usr_bob', displayName: 'Bob' }
                ],
                favoriteWorlds: [
                    { id: 'wrld_remote_fav', name: 'Remote Favorite' },
                    { id: 'wrld_other', name: 'Other World' }
                ],
                avatars: [
                    { id: 'avtr_z', name: 'Zulu', releaseStatus: 'private' },
                    { id: 'avtr_a', name: 'Alpha', releaseStatus: 'public' },
                    { id: 'avtr_b', name: 'Beta', releaseStatus: 'public' }
                ]
            },
            remoteStatus: {
                groups: 'ready',
                mutual: 'ready',
                'favorite-worlds': 'ready',
                avatars: 'ready'
            },
            friendsById: {
                usr_alice: {
                    id: 'usr_alice',
                    displayName: 'Alice Cached',
                    $friendNumber: 2
                }
            },
            search: {
                mutual: 'alice',
                groups: 'beta',
                worlds: 'tree',
                favoriteWorlds: 'remote',
                avatars: ''
            },
            mutualSort: 'alphabetical',
            groupSort: 'inGame',
            isCurrentUser: false,
            inGameGroupOrder: ['grp_beta'],
            selectedGroupIds,
            effectiveAvatarReleaseStatus: 'public',
            avatarSort: 'name',
            currentUserHasSharedConnectionsOptOut: false
        });

        expect(viewData.effectiveGroupSort).toBe('alphabetical');
        expect(viewData.sortedProfileGroups.map((group) => group.id)).toEqual([
            'grp_alpha',
            'grp_beta'
        ]);
        expect(viewData.filteredProfileGroups.map((group) => group.id)).toEqual(
            ['grp_beta']
        );
        expect(viewData.selectedUserGroups.map((group) => group.id)).toEqual([
            'grp_beta'
        ]);
        expect(
            viewData.visibleMutualFriends.map((friend) => friend.displayName)
        ).toEqual(['Alice']);
        expect(viewData.filteredProfileWorlds.map((world) => world.id)).toEqual(
            ['wrld_tree']
        );
        expect(
            viewData.filteredFavoriteWorlds.map((world) => world.id)
        ).toEqual(['wrld_remote_fav']);
        expect(
            viewData.visibleProfileAvatars.map((avatar) => avatar.id)
        ).toEqual(['avtr_a', 'avtr_b']);
        expect(viewData.bioLinks).toEqual(['https://example.test/profile']);
        expect(viewData.groupSearchActive).toBe(true);
    });

    it('keeps current-user avatar release filters predictable for all and private views', () => {
        const buildAvatarView = (effectiveAvatarReleaseStatus) =>
            buildUserDialogListViewData({
                profile: {},
                remoteData: {
                    avatars: [
                        {
                            id: 'avtr_private',
                            name: 'Private Avatar',
                            releaseStatus: 'private'
                        },
                        {
                            id: 'avtr_public',
                            name: 'Public Avatar',
                            releaseStatus: 'public'
                        }
                    ]
                },
                remoteStatus: {
                    avatars: 'ready'
                },
                friendsById: {},
                search: {
                    mutual: '',
                    groups: '',
                    worlds: '',
                    favoriteWorlds: '',
                    avatars: ''
                },
                mutualSort: 'alphabetical',
                groupSort: 'inGame',
                isCurrentUser: true,
                inGameGroupOrder: [],
                selectedGroupIds: new Set(),
                effectiveAvatarReleaseStatus,
                avatarSort: 'name',
                currentUserHasSharedConnectionsOptOut: false
            });

        expect(
            buildAvatarView('all').visibleProfileAvatars.map(
                (avatar) => avatar.id
            )
        ).toEqual(['avtr_private', 'avtr_public']);
        expect(
            buildAvatarView('private').visibleProfileAvatars.map(
                (avatar) => avatar.id
            )
        ).toEqual(['avtr_private']);
    });

    it('summarizes profile stats, group sections, languages, and previous names for display', () => {
        const summary = buildUserDialogProfileSummary({
            profile: {
                id: 'usr_me',
                state: 'active',
                status: 'join me',
                previousDisplayNames: [{ displayName: 'Profile Name' }],
                tags: ['language_jpn'],
                $friendNumber: 42,
                mutualFriendCount: 4,
                timeSpent: 2000,
                joinCount: 8
            },
            userStats: {
                timeSpent: 3000,
                lastSeen: '2026-01-02T03:04:05',
                joinCount: 9,
                previousDisplayNames: [
                    {
                        displayName: 'Old Name',
                        updated_at: '2026-01-02T03:04:05'
                    }
                ]
            },
            sortedProfileGroups: [
                { id: 'grp_owned', name: 'Owned', ownerId: 'usr_me' },
                { id: 'grp_mutual', name: 'Mutual', mutualGroup: true },
                { id: 'grp_regular', name: 'Regular' }
            ],
            selectedUserGroups: [{ id: 'grp_owned' }, { id: 'grp_regular' }],
            mutualFriends: [{ id: 'usr_one' }, { id: 'usr_two' }],
            isCurrentUser: true,
            vrchatConfigConstants: {
                GROUPS: {
                    MAX_OWNED: 3,
                    MAX_JOINED: 5,
                    MAX_JOINED_PLUS: 10
                }
            },
            currentUserSnapshot: {
                tags: ['system_supporter']
            }
        });

        expect(summary.previousDisplayNames).toEqual([
            { displayName: 'Old Name', updated_at: '2026-01-02T03:04:05' }
        ]);
        expect(summary.previousDisplayNamesTitle).toBe(
            'Old Name - 2026-01-02 03:04:05'
        );
        expect(summary.statusStateText).toBe('active / join me');
        expect(
            summary.userGroupSections.ownGroups.map((group) => group.id)
        ).toEqual(['grp_owned']);
        expect(summary.userGroupSections.mutualGroups).toEqual([]);
        expect(
            summary.userGroupSections.remainingGroups.map((group) => group.id)
        ).toEqual(['grp_mutual', 'grp_regular']);
        expect(summary.selectedGroupCount).toBe(2);
        expect(summary.ownGroupCountText).toBe('1/3');
        expect(summary.remainingGroupCountText).toBe('2/10');
        expect(summary.userTimeSpent).toBe(3000);
        expect(summary.userJoinCount).toBe(9);
        expect(summary.lastSeen).toBe('2026-01-02T03:04:05');
        expect(summary.profileLanguages).toEqual([
            { key: 'jpn', value: 'JPN' }
        ]);
        expect(summary.mutualFriendCount).toBe(4);
        expect(summary.friendNumber).toBe(42);
    });
});
