import { describe, expect, it } from 'vitest';

import {
    isUserDialogDataTab,
    loadUserDialogTabData,
    userDialogAvatarSortRequest,
    userDialogDataKeyForTab
} from './userDialogTabService';

function repositories(overrides: any = {}) {
    return {
        avatarProfileRepository: {
            getAllAvatarsByUser: async (): Promise<unknown[]> => []
        },
        avatarSearchProviderRepository: {
            getConfig: async () => ({ enabled: false, selectedProvider: '' }),
            search: async (): Promise<{ avatars: unknown[] }> => ({
                avatars: []
            })
        },
        myAvatarRepository: {
            getMyAvatars: async (): Promise<unknown[]> => []
        },
        groupProfileRepository: {
            getUserGroups: async (): Promise<unknown[]> => []
        },
        userProfileRepository: {
            getAllMutualFriends: async (): Promise<unknown[]> => []
        },
        vrchatFavoriteRepository: {
            getAllFavoriteGroups: async (): Promise<unknown[]> => [],
            getAllFavoriteWorlds: async (): Promise<unknown[]> => []
        },
        worldProfileRepository: {
            getAllWorldsByUser: async (): Promise<unknown[]> => []
        },
        ...overrides
    };
}

describe('userDialogTabService', () => {
    it('recognizes tabs that load remote dialog data', () => {
        expect(isUserDialogDataTab('mutual')).toBe(true);
        expect(isUserDialogDataTab('favorite-worlds')).toBe(true);
        expect(isUserDialogDataTab('info')).toBe(false);
        expect(userDialogDataKeyForTab('favorite-worlds')).toBe(
            'favoriteWorlds'
        );
        expect(userDialogDataKeyForTab('groups')).toBe('groups');
    });

    it('requests mutual friends, groups, and worlds with the viewed user context', async () => {
        const calls: [string, unknown][] = [];
        const fakeRepositories = repositories({
            userProfileRepository: {
                getAllMutualFriends: async (params: any) => {
                    calls.push(['mutual', params]);
                    return [{ id: 'usr_friend' }];
                }
            },
            groupProfileRepository: {
                getUserGroups: async (params: any) => {
                    calls.push(['groups', params]);
                    return [{ id: 'grp_one' }];
                }
            },
            worldProfileRepository: {
                getAllWorldsByUser: async (params: any) => {
                    calls.push(['worlds', params]);
                    return [{ id: 'wrld_one' }];
                }
            }
        });

        await expect(
            loadUserDialogTabData({
                tab: 'mutual',
                userId: 'usr_target',
                endpoint: 'https://api.example.test',
                repositories: fakeRepositories
            })
        ).resolves.toEqual({
            rows: [{ id: 'usr_friend' }],
            favoriteWorldGroups: []
        });
        await expect(
            loadUserDialogTabData({
                tab: 'groups',
                userId: 'usr_target',
                endpoint: 'https://api.example.test',
                repositories: fakeRepositories
            })
        ).resolves.toEqual({
            rows: [{ id: 'grp_one' }],
            favoriteWorldGroups: []
        });
        await expect(
            loadUserDialogTabData({
                tab: 'worlds',
                userId: 'usr_target',
                endpoint: 'https://api.example.test',
                currentUserId: 'usr_self',
                worldSort: 'updated',
                worldOrder: 'descending',
                repositories: fakeRepositories
            })
        ).resolves.toEqual({
            rows: [{ id: 'wrld_one' }],
            favoriteWorldGroups: []
        });

        expect(calls).toEqual([
            [
                'mutual',
                { userId: 'usr_target', endpoint: 'https://api.example.test' }
            ],
            [
                'groups',
                { userId: 'usr_target', endpoint: 'https://api.example.test' }
            ],
            [
                'worlds',
                {
                    userId: 'usr_target',
                    endpoint: 'https://api.example.test',
                    sort: 'updated',
                    order: 'descending',
                    releaseStatus: 'public'
                }
            ]
        ]);
    });

    it('loads current-user avatars through the My Avatars repository', async () => {
        let request = null;
        const fakeRepositories = repositories({
            myAvatarRepository: {
                getMyAvatars: async (params: any) => {
                    request = params;
                    return [{ id: 'avtr_private' }];
                }
            }
        });

        await expect(
            loadUserDialogTabData({
                tab: 'avatars',
                userId: 'usr_self',
                currentUserId: 'usr_self',
                currentAvatarId: 'avtr_current',
                previousAvatarSwapTime: 1234,
                endpoint: 'https://api.example.test',
                avatarSort: 'update',
                effectiveAvatarReleaseStatus: 'private',
                repositories: fakeRepositories
            })
        ).resolves.toEqual({
            rows: [{ id: 'avtr_private' }],
            favoriteWorldGroups: []
        });

        expect(request).toEqual({
            endpoint: 'https://api.example.test',
            currentUserId: 'usr_self',
            currentAvatarId: 'avtr_current',
            previousAvatarSwapTime: 1234
        });
        expect(userDialogAvatarSortRequest('createdAt')).toEqual({
            sort: 'createdAt',
            order: 'descending'
        });
        expect(userDialogAvatarSortRequest('name')).toEqual({
            sort: 'name',
            order: 'ascending'
        });
    });

    it('loads another user avatars through the selected search provider', async () => {
        let searchRequest = null;
        const fakeRepositories = repositories({
            avatarSearchProviderRepository: {
                getConfig: async () => ({
                    enabled: true,
                    selectedProvider: 'provider-a'
                }),
                search: async (params: any) => {
                    searchRequest = params;
                    return {
                        avatars: [
                            { id: 'avtr_target', authorId: 'usr_target' },
                            { id: 'avtr_other', authorId: 'usr_other' }
                        ]
                    };
                }
            }
        });

        await expect(
            loadUserDialogTabData({
                tab: 'avatars',
                userId: 'usr_target',
                currentUserId: 'usr_self',
                repositories: fakeRepositories
            })
        ).resolves.toEqual({
            rows: [{ id: 'avtr_target', authorId: 'usr_target' }],
            favoriteWorldGroups: []
        });
        expect(searchRequest).toEqual({
            provider: 'provider-a',
            query: 'usr_target'
        });

        await expect(
            loadUserDialogTabData({
                tab: 'avatars',
                userId: 'usr_target',
                currentUserId: 'usr_self',
                repositories: repositories()
            })
        ).resolves.toEqual({ rows: [], favoriteWorldGroups: [] });
    });

    it('loads favorite worlds by world favorite group and keeps partial successes', async () => {
        let favoriteGroupRequest = null;
        const favoriteWorldRequests: unknown[] = [];
        const fakeRepositories = repositories({
            vrchatFavoriteRepository: {
                getAllFavoriteGroups: async (params: any) => {
                    favoriteGroupRequest = params;
                    return [
                        {
                            name: 'worlds_a',
                            displayName: 'Worlds A',
                            type: 'world'
                        },
                        {
                            name: 'avatars_a',
                            displayName: 'Avatars A',
                            type: 'avatar'
                        },
                        { name: 'worlds_b', type: 'world' }
                    ];
                },
                getAllFavoriteWorlds: async (params: any) => {
                    favoriteWorldRequests.push(params);
                    if (params.tag === 'worlds_b') {
                        throw new Error('group unavailable');
                    }
                    return [{ id: 'wrld_a', name: 'World A' }];
                }
            }
        });

        await expect(
            loadUserDialogTabData({
                tab: 'favorite-worlds',
                userId: 'usr_target',
                endpoint: 'https://api.example.test',
                repositories: fakeRepositories
            })
        ).resolves.toEqual({
            rows: [
                {
                    id: 'wrld_a',
                    name: 'World A',
                    $favoriteGroup: 'Worlds A',
                    $favoriteGroupKey: 'worlds_a'
                }
            ],
            favoriteWorldGroups: [
                { name: 'worlds_a', displayName: 'Worlds A', type: 'world' },
                { name: 'worlds_b', type: 'world' }
            ]
        });
        expect(favoriteGroupRequest).toEqual({
            endpoint: 'https://api.example.test',
            ownerId: 'usr_target'
        });
        expect(favoriteWorldRequests).toEqual([
            {
                endpoint: 'https://api.example.test',
                ownerId: 'usr_target',
                userId: 'usr_target',
                tag: 'worlds_a'
            },
            {
                endpoint: 'https://api.example.test',
                ownerId: 'usr_target',
                userId: 'usr_target',
                tag: 'worlds_b'
            }
        ]);
    });
});
